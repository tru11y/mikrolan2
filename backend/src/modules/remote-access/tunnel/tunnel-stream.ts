import * as net from 'node:net';
import {
  INITIAL_CREDIT,
  MAX_DATA,
  encodeClose,
  encodeData,
  encodeWindow,
} from './tunnel-protocol';

/** Au-delà, on met en pause la lecture de la socket routeur (backpressure WS). */
const WS_BUFFER_HIGH = 1 << 20; // 1 Mio
/** Au-delà de crédit en attente d'envoi, on met aussi la socket en pause. */
const QUEUE_HIGH = 256 * 1024;
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Un stream = une socket TCP vers un service du routeur (wgIp:port), pontée au
 * WS avec contrôle de flux par crédit dans les deux sens et backpressure.
 *
 * Sens routeur→client (DATA sortant) : on n'émet que dans la limite du crédit
 * accordé par le client (`sendCredit`) et tant que `ws.bufferedAmount` reste
 * bas ; sinon on `socket.pause()`. Le client renvoie WINDOW en drainant.
 *
 * Sens client→routeur (DATA entrant) : on écrit sur la socket ; on ne renvoie
 * WINDOW (réapprovisionnement du crédit client) qu'une fois les octets acceptés
 * par la socket (sur `drain` si elle sature) → le débit du routeur régule le
 * client. Aucune allocation illimitée : la file sortante est bornée par le
 * crédit (65536 o) et la pause de lecture.
 */
export class TunnelStream {
  private socket: net.Socket | null = null;
  private closed = false;
  private paused = false;

  // Sens routeur→client.
  private sendCredit = INITIAL_CREDIT;
  private outQueue: Buffer[] = [];
  private outQueueBytes = 0;
  private flushScheduled = false;

  // Sens client→routeur.
  private pendingWindow = 0;

  bytesUp = 0; // client → routeur
  bytesDown = 0; // routeur → client

  constructor(
    readonly streamId: number,
    private readonly send: (frame: Buffer) => void,
    private readonly bufferedAmount: () => number,
    private readonly onClosed: (stream: TunnelStream) => void,
  ) {}

  /** Ouvre la socket vers le service. Rejette (timeout 5 s / erreur) → OPEN_ERR. */
  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`connect timeout ${host}:${port}`));
      }, CONNECT_TIMEOUT_MS);

      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        this.bind(socket);
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private bind(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => {
      this.outQueue.push(chunk);
      this.outQueueBytes += chunk.length;
      this.flushOut();
    });
    socket.on('drain', () => {
      if (this.pendingWindow > 0) {
        this.send(encodeWindow(this.streamId, this.pendingWindow));
        this.pendingWindow = 0;
      }
    });
    socket.on('end', () => this.teardown('socket-end'));
    socket.on('close', () => this.teardown('socket-close'));
    socket.on('error', () => this.teardown('socket-error'));
  }

  /** DATA reçu du client → écrit vers le routeur ; régule le crédit client. */
  onData(data: Buffer): void {
    if (this.closed || !this.socket) return;
    this.bytesUp += data.length;
    const accepted = this.socket.write(data);
    if (accepted) {
      // La socket a tout absorbé : on réapprovisionne immédiatement le client.
      this.send(encodeWindow(this.streamId, data.length));
    } else {
      // Socket saturée : on diffère le WINDOW au `drain` → freine le client.
      this.pendingWindow += data.length;
    }
  }

  /** Le client accorde du crédit supplémentaire (sens routeur→client). */
  onWindow(credit: number): void {
    this.sendCredit += credit;
    this.flushOut();
  }

  /** CLOSE reçu du client. */
  onClose(): void {
    this.teardown('peer-close');
  }

  private flushOut(): void {
    if (this.closed || !this.socket) return;
    while (
      this.sendCredit > 0 &&
      this.outQueueBytes > 0 &&
      this.bufferedAmount() < WS_BUFFER_HIGH
    ) {
      const max = Math.min(this.sendCredit, MAX_DATA);
      const chunk = this.dequeue(max);
      if (chunk.length === 0) break;
      this.bytesDown += chunk.length;
      this.sendCredit -= chunk.length;
      this.send(encodeData(this.streamId, chunk));
    }

    const over =
      this.outQueueBytes > QUEUE_HIGH ||
      this.bufferedAmount() >= WS_BUFFER_HIGH ||
      this.sendCredit <= 0;
    if (over && !this.paused) {
      this.socket.pause();
      this.paused = true;
    } else if (!over && this.paused) {
      this.socket.resume();
      this.paused = false;
    }

    // Le WS n'émet pas d'évènement de drain fiable : si des octets restent en
    // file (crédit dispo mais buffer WS plein), on replanifie un flush court.
    if (this.outQueueBytes > 0 && this.sendCredit > 0 && !this.flushScheduled) {
      this.flushScheduled = true;
      setTimeout(() => {
        this.flushScheduled = false;
        this.flushOut();
      }, 10).unref?.();
    }
  }

  private dequeue(max: number): Buffer {
    const first = this.outQueue[0];
    if (!first) return Buffer.alloc(0);
    if (first.length <= max) {
      this.outQueue.shift();
      this.outQueueBytes -= first.length;
      return first;
    }
    const head = first.subarray(0, max);
    this.outQueue[0] = first.subarray(max);
    this.outQueueBytes -= max;
    return head;
  }

  private teardown(_why: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.outQueue = [];
    this.outQueueBytes = 0;
    try {
      this.send(encodeClose(this.streamId));
    } catch {
      /* WS already gone */
    }
    this.onClosed(this);
  }

  /** Fermeture imposée (GOAWAY de session) sans ré-émettre de CLOSE. */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.outQueue = [];
    this.outQueueBytes = 0;
  }
}

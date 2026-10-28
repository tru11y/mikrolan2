import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../config/configuration';

export class ReleaseStorageUnavailableError extends Error {}

export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

// Un APK de ~90 Mo sur une liaison lente : l'URL doit survivre à l'envoi.
const UPLOAD_URL_TTL_SECONDS = 1800;

/** Nom de fichier sûr pour l'en-tête Content-Disposition : lettres, chiffres, point, tiret, souligné. */
export function safeFilename(name: string | undefined): string | null {
  const cleaned = (name ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : null;
}

/** Accès au bucket S3 privé des APK : HEAD (vérification) et URL signée de téléchargement. */
@Injectable()
export class ReleaseStorageService {
  private readonly logger = new Logger(ReleaseStorageService.name);
  private readonly bucket: string;
  private readonly region: string;
  private readonly ttl: number;
  private client: S3Client | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.bucket = config.get('RELEASES_S3_BUCKET', { infer: true });
    this.region = config.get('RELEASES_S3_REGION', { infer: true });
    this.ttl = config.get('RELEASES_URL_TTL', { infer: true });
  }

  /** Taille de l'objet, ou `null` s'il n'existe pas. */
  async headSize(key: string): Promise<number | null> {
    const client = this.s3();
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return out.ContentLength ?? null;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      this.logger.error(`S3 HEAD a échoué (${e.name ?? 'unknown'})`);
      throw new ReleaseStorageUnavailableError('S3 HEAD failed');
    }
  }

  /** URL de dépôt directe PC → S3 ; seul Content-Length est signé (taille imposée par S3). */
  async presignUpload(key: string, size: number): Promise<string> {
    const client = this.s3();
    try {
      return await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: APK_CONTENT_TYPE,
          ContentLength: size,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS },
      );
    } catch {
      throw new ReleaseStorageUnavailableError('S3 presign failed');
    }
  }

  /** Origine S3 à autoriser en `connect-src` pour l'upload navigateur ('' si non configuré). */
  get uploadOrigin(): string {
    return this.bucket && this.region
      ? `https://${this.bucket}.s3.${this.region}.amazonaws.com`
      : '';
  }

  /**
   * URL signée de téléchargement. `filename` est le nom proposé au téléphone, distinct de la clé de
   * stockage (qui porte un suffixe aléatoire, inutile à l'utilisateur) ; par défaut, la fin de la clé.
   */
  async presignDownload(key: string, filename?: string): Promise<string> {
    const client = this.s3();
    const name = safeFilename(filename) ?? key.slice(key.lastIndexOf('/') + 1);
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${name}"`,
          ResponseContentType: APK_CONTENT_TYPE,
        }),
        { expiresIn: this.ttl },
      );
    } catch {
      throw new ReleaseStorageUnavailableError('S3 presign failed');
    }
  }

  private s3(): S3Client {
    if (!this.bucket || !this.region) {
      throw new ReleaseStorageUnavailableError('RELEASES_S3_* non configuré');
    }
    // WHEN_REQUIRED : sinon le SDK injecte un checksum du corps vide dans l'URL
    // signée et tout envoi réel échoue.
    this.client ??= new S3Client({
      region: this.region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    return this.client;
  }
}

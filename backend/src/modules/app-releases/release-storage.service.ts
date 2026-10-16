import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../config/configuration';

export class ReleaseStorageUnavailableError extends Error {}

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

  async presignDownload(key: string): Promise<string> {
    const client = this.s3();
    const filename = key.slice(key.lastIndexOf('/') + 1);
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
          ResponseContentType: 'application/vnd.android.package-archive',
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
    this.client ??= new S3Client({ region: this.region });
    return this.client;
  }
}

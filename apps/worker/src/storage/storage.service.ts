import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { WORKER_ENV, type WorkerEnv } from '../env';

/**
 * Bucket S3-compatível (MinIO local, bucket do Railway em produção).
 * O bucket é privado: leitura sempre por URL assinada e com expiração.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    this.s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
    this.bucket = env.S3_BUCKET;
    this.ttl = env.S3_SIGNED_URL_TTL;
  }

  async put(key: string, body: Uint8Array, contentType: string | null): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType ?? 'application/octet-stream' }),
    );
  }

  /** Remove o objeto (rotina de retenção). Apagar algo que não existe não é erro no S3. */
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedGetUrl(key: string, ttlSeconds = this.ttl): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async ping(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

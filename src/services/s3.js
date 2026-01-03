import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
  console.warn('S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY not set - S3 uploads will fail until configured');
}

export const s3 = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId: accessKeyId || '',
    secretAccessKey: secretAccessKey || '',
  },
  forcePathStyle: false,
});

export const uploadToS3 = async (fileBuffer, contentType, prefix = 'securepdf/') => {
  if (!bucket) {
    throw new Error('S3_BUCKET not configured');
  }

  const key = `${prefix}${crypto.randomUUID()}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await s3.send(command);

  return { key, url: `s3://${bucket}/${key}` };
};

export const uploadToS3WithKey = async (fileBuffer, contentType, key) => {
  if (!bucket) {
    throw new Error('S3_BUCKET not configured');
  }

  const normalizedKey = typeof key === 'string' ? key : '';
  if (!normalizedKey) {
    throw new Error('S3 key is required');
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: normalizedKey,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await s3.send(command);

  return { key: normalizedKey, url: `s3://${bucket}/${normalizedKey}` };
};

export const uploadFileToS3WithKey = async (filePath, contentType, key) => {
  throw new Error('Local file uploads are disabled. Provide a Buffer and use uploadToS3WithKey instead.');
};

export const getObjectStreamFromS3 = async (key) => {
  if (!bucket) {
    throw new Error('S3_BUCKET not configured');
  }
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  return response;
};

export const downloadFromS3 = async (key) => {
  if (!bucket) {
    throw new Error('S3_BUCKET not configured');
  }

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

export const deleteFromS3 = async (key) => {
  if (!bucket) {
    throw new Error('S3_BUCKET not configured');
  }

  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await s3.send(command);
};

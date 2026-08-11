import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../../config/r2.js";

const ARTIFACT_SIZE_THRESHOLD_BYTES = Number(
  process.env.ARTIFACT_SIZE_THRESHOLD_BYTES || 102400
);

function getBucketName() {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }
  return bucket;
}

function getExtension(contentType = "") {
  if (contentType.includes("html")) return "html";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("text")) return "txt";
  return "bin";
}

export function shouldStoreInR2(content) {
  const size =
    typeof content === "string"
      ? Buffer.byteLength(content, "utf8")
      : content.length;
  return size > ARTIFACT_SIZE_THRESHOLD_BYTES;
}

export async function saveArtifact({
  prefix,
  rawEventId,
  content,
  contentType = "application/octet-stream",
  extension,
}) {
  const body =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;

  const ext = extension || getExtension(contentType);
  const key = `pipeline/${prefix}/${rawEventId}/${Date.now()}.${ext}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return {
    r2_key: key,
    size_bytes: body.length,
  };
}

export { ARTIFACT_SIZE_THRESHOLD_BYTES };

import { X509Certificate } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Supabase Studio's official production CA download, pinned to its 2021 CA.
// Source: supabase/supabase apps/studio/hooks/custom-content/custom-content.json
const url =
  "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt";
let pem = process.env.DATABASE_CA_CERT;
if (!pem) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error("Official database CA download failed: " + response.status);
  pem = await response.text();
}
const certificate = new X509Certificate(pem.replaceAll("\\n", "\n"));
if (
  !process.env.DATABASE_CA_CERT &&
  certificate.fingerprint256 !==
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
) {
  throw new Error(
    "Official Supabase CA fingerprint changed; verify the provider certificate before updating trust",
  );
}
if (
  !certificate.ca ||
  Date.parse(certificate.validTo) <= Date.now() ||
  Date.parse(certificate.validFrom) > Date.now()
) {
  throw new Error("Database CA is not a currently valid CA certificate");
}
await mkdir(".certificates", { recursive: true });
await writeFile(".certificates/supabase-ca.crt", certificate.toString(), {
  mode: 0o644,
});
console.log(
  "Verified official database CA artifact:",
  certificate.fingerprint256,
);

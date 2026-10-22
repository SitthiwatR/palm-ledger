export function validImageSignature(bytes: Buffer, mime: string) {
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (mime === "image/heic" || mime === "image/heif") {
    const boxType = bytes.toString("ascii", 4, 8);
    const brand = bytes.toString("ascii", 8, 12);
    const compatible = bytes.toString("ascii", 16, Math.min(bytes.length, 40));
    return (
      boxType === "ftyp" &&
      /^(heic|heix|hevc|hevx|heim|heis|heif|mif1|msf1)$/.test(brand) &&
      /heic|heix|hevc|hevx|heim|heis|heif|mif1|msf1/.test(compatible)
    );
  }
  return false;
}

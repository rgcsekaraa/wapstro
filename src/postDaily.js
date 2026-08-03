import { cleanCaption } from "./image.js";
import { downloadSrirangamForParts } from "./srirangam.js";

// Send the primary image first. Srirangam is a useful second source, but an
// upstream outage must never suppress the already-available primary calendar.
export async function postDailyImages({
  sock,
  jid,
  targetLabel,
  parts,
  primary,
  imageCaption = "",
  srirangamImageCaption = "",
  loadSrirangam = downloadSrirangamForParts,
  logger = console,
}) {
  const primaryCaption = cleanCaption(
    imageCaption.trim()
      ? imageCaption.replace("{date}", parts.label)
      : `Daily Raasi Palan ${parts.label}`
  );

  await sock.sendMessage(jid, { image: primary.buffer, caption: primaryCaption });
  logger.log(`Sent Tamil Daily Calendar image to ${targetLabel} group.`);

  try {
    logger.log("Resolving today's Srirangam Tamil calendar image...");
    const srirangam = await loadSrirangam(parts);
    logger.log(
      `Got ${srirangam.buffer.length} bytes from ${srirangam.url} (via ${srirangam.via})`
    );

    const caption = cleanCaption(
      srirangamImageCaption.trim()
        ? srirangamImageCaption.replace("{date}", parts.label)
        : `Srirangam Tamil Calendar ${parts.label}`
    );
    await sock.sendMessage(jid, { image: srirangam.buffer, caption });
    logger.log(`Sent Srirangam Tamil calendar image to ${targetLabel} group.`);
    return { primarySent: true, srirangamSent: true, srirangam };
  } catch (error) {
    logger.warn(
      `Srirangam Tamil calendar was not sent for ${parts.label}: ${error.message}. ` +
        "The primary Tamil Daily Calendar was sent successfully."
    );
    return { primarySent: true, srirangamSent: false, srirangam: null, srirangamError: error };
  }
}

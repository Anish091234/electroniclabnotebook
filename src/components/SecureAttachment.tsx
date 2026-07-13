import { useEffect, useState } from "react";
import { getBlob, ref } from "firebase/storage";
import type { AttachmentRecord } from "../data/types";
import { storage } from "../lib/firebase";

function isTrustedAttachment(attachment: AttachmentRecord) {
  return attachment.state === "finalized"
    && typeof attachment.generation === "string"
    && /^[a-f0-9]{64}$/i.test(attachment.sha256)
    && attachment.storagePath.endsWith(`/${attachment.id}`)
    && /^labs\/[^/]+\/experiments\/[^/]+\/[A-Za-z0-9_-]{12,128}$/.test(attachment.storagePath);
}

async function attachmentBlob(attachment: AttachmentRecord) {
  if (!storage || !isTrustedAttachment(attachment)) {
    throw new Error("This attachment needs migration before it can be opened securely.");
  }

  return getBlob(ref(storage, attachment.storagePath));
}

export function SecureAttachmentImage({ attachment, alt, className }: { attachment: AttachmentRecord | undefined; alt: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setObjectUrl(null);
    setError(null);

    if (!attachment) {
      setError("The referenced attachment is unavailable.");
      return () => undefined;
    }

    void attachmentBlob(attachment)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (active) setError("The image could not be loaded through the authenticated attachment channel.");
      });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment, attachment?.generation, attachment?.id, attachment?.sha256, attachment?.state, attachment?.storagePath]);

  if (error) return <p className="authoring-empty">{error}</p>;
  if (!objectUrl) return <p className="authoring-empty">Loading authenticated image…</p>;
  return <img className={className} src={objectUrl} alt={alt} />;
}

export function SecureAttachmentDownloadButton({ attachment, className }: { attachment: AttachmentRecord; className?: string }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setError(null);
    setIsDownloading(true);
    try {
      const blob = await attachmentBlob(attachment);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download attachment.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="secure-attachment-download">
      <button className={className} type="button" disabled={isDownloading} onClick={download}>
        <span>{attachment.fileName}</span>
        <small>{isDownloading ? "Preparing…" : `${Math.ceil(attachment.size / 1024)} KB`}</small>
      </button>
      {error && <small className="secure-attachment-error">{error}</small>}
    </div>
  );
}

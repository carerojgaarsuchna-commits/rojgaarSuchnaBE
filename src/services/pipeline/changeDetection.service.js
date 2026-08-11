import axios from "axios";

const HTML_TIMEOUT_MS = Number(process.env.PIPELINE_HTML_TIMEOUT_MS || 4000);
const MAX_RETRIES = 1;

function getApiConfig() {
  const baseUrl = process.env.CHANGEDETECTION_API_URL;
  const token = process.env.CHANGEDETECTION_API_TOKEN;

  if (!baseUrl || !token) {
    return null;
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

function buildSnapshotUrl(baseUrl, watchUuid) {
  return `${baseUrl}/api/v1/watch/${watchUuid}/history/latest?html=1`;
}

function extractSnapshotTimestamp(responseData) {
  if (!responseData || typeof responseData !== "object") {
    return null;
  }

  return (
    responseData.timestamp ||
    responseData.snapshot_timestamp ||
    responseData.time ||
    responseData?.history?.[0]?.timestamp ||
    null
  );
}

function extractHtml(responseData) {
  if (typeof responseData === "string") {
    return responseData;
  }

  if (!responseData || typeof responseData !== "object") {
    return null;
  }

  return (
    responseData.html ||
    responseData.content ||
    responseData.body ||
    responseData?.history?.[0]?.html ||
    null
  );
}

function snapshotsLookMismatch(webhookChangeDatetime, snapshotTimestamp) {
  if (!webhookChangeDatetime || !snapshotTimestamp) {
    return false;
  }

  const webhookTime = new Date(webhookChangeDatetime).getTime();
  const snapshotTime = new Date(snapshotTimestamp).getTime();

  if (Number.isNaN(webhookTime) || Number.isNaN(snapshotTime)) {
    return false;
  }

  const diffMs = Math.abs(webhookTime - snapshotTime);
  const sixHoursMs = 6 * 60 * 60 * 1000;

  return diffMs > sixHoursMs;
}

async function fetchOnce(url, token, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await axios.get(url, {
      headers: {
        "x-api-key": token,
        Accept: "application/json, text/html",
      },
      timeout: timeoutMs,
      signal: controller.signal,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const html = extractHtml(response.data);
    const snapshotTimestamp = extractSnapshotTimestamp(response.data);

    if (!html || !String(html).trim()) {
      return {
        ok: false,
        error: "ChangeDetection returned empty HTML",
      };
    }

    return {
      ok: true,
      html: String(html),
      snapshotTimestamp: snapshotTimestamp ? String(snapshotTimestamp) : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLatestHtmlSnapshot({ watchUuid, changeDatetime }) {
  const config = getApiConfig();

  if (!config) {
    return {
      ok: false,
      error: "ChangeDetection API is not configured",
    };
  }

  const url = buildSnapshotUrl(config.baseUrl, watchUuid);
  let lastError = "Unknown ChangeDetection error";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await fetchOnce(url, config.token, HTML_TIMEOUT_MS);
      if (!result.ok) {
        lastError = result.error;
        continue;
      }

      const retrievalTimestamp = new Date();
      const mismatch = snapshotsLookMismatch(
        changeDatetime,
        result.snapshotTimestamp
      );

      return {
        ok: true,
        html: result.html,
        snapshotTimestamp: result.snapshotTimestamp,
        retrievalTimestamp,
        mismatch,
        mismatchReason: mismatch
          ? "Webhook change_datetime and snapshot timestamp differ by more than 6 hours"
          : null,
      };
    } catch (err) {
      if (err.code === "ECONNABORTED" || err.name === "AbortError") {
        lastError = "ChangeDetection HTML request timed out";
      } else if (err.response?.status) {
        lastError = `ChangeDetection returned HTTP ${err.response.status}`;
      } else {
        lastError = err.message || lastError;
      }
    }
  }

  return {
    ok: false,
    error: lastError,
  };
}

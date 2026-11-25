/**
 * Popup: the extension's only settings surface.
 *
 * Nothing here scores anything — it reads/writes chrome.storage.sync, which the
 * content script and service worker both observe. A custom endpoint needs its
 * origin granted at runtime, because host_permissions in the manifest only
 * covers the deployed Worker.
 */

const DEFAULT_ENDPOINT = 'https://x-lead-miner.ideaguard.dev/api/leads/score';

const $ = (id) => document.getElementById(id);

function flash(text) {
  const hint = $('hint');
  hint.textContent = text;
  hint.hidden = !text;
}

async function render() {
  const { enabled, endpoint } = await chrome.storage.sync.get({
    enabled: true,
    endpoint: DEFAULT_ENDPOINT,
  });
  $('enabled').checked = enabled;
  $('endpoint').value = endpoint;

  const session = await chrome.storage.session.get({ scoredCount: 0, lastError: null });
  $('count').textContent = String(session.scoredCount ?? 0);

  const error = $('error');
  if (session.lastError?.message) {
    error.textContent = `最近错误：${session.lastError.message}`;
    error.hidden = false;
  } else {
    error.hidden = true;
  }
}

$('enabled').addEventListener('change', (event) => {
  chrome.storage.sync.set({ enabled: event.target.checked });
});

$('save').addEventListener('click', () => {
  const raw = $('endpoint').value.trim() || DEFAULT_ENDPOINT;
  let origin;
  try {
    origin = new URL(raw).origin;
  } catch {
    flash('不是合法的 URL');
    return;
  }

  // permissions.request has to run inside the click gesture — awaiting
  // anything first drops the activation and the prompt never opens. An origin
  // that is already granted resolves true without a prompt.
  chrome.permissions
    .request({ origins: [`${origin}/*`] })
    .then((granted) => {
      if (!granted) {
        flash(`未授权访问 ${origin}，端点未保存`);
        return;
      }
      return chrome.storage.sync.set({ endpoint: raw }).then(() => flash('已保存'));
    })
    .catch(() => flash('保存失败'));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' || area === 'session') void render();
});

void render();

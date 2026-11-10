/*
 * trippo.hu/meghivo/<code>: an accountant's invite. Shows which office invites, the App Store button and
 * the code to type into the app (a link can't survive the App Store install, so the code always works).
 * Nothing is shared from here: the client agrees in the app. Server text only goes in through textContent.
 */
import { formatInviteCode, normalizeInviteCode } from '/invite-code.js';

const FN = 'https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/accountant';
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

const rawPath = location.pathname.replace(/^\/meghivo(\.html)?\/?/, '');
let fromPath = rawPath;
try {
  fromPath = decodeURIComponent(rawPath);
} catch {}
const code = normalizeInviteCode(fromPath);

async function officeOf(c) {
  try {
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invite-info', code: c }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body.office === 'string') return { office: body.office };
    return { problem: res.status === 404 ? 'invalid' : 'busy' };
  } catch {
    return { problem: 'network' };
  }
}

function invalid() {
  $('title').textContent = 'Ez a meghívó nem érvényes';
  show('lead', false);
  show('bad');
  show('code-step', false);
  document.title = 'Érvénytelen meghívó | Trippo';
}

async function main() {
  if (!code) {
    if (fromPath) return invalid();
    show('no-code');
    return;
  }
  const pretty = formatInviteCode(code);
  $('code').textContent = pretty;
  show('code-box');
  $('open-app').href = `trippo://meghivo/${pretty}`;
  show('open-wrap');
  // The address bar shows the tidy form, whatever was typed or scanned.
  if (fromPath !== pretty) history.replaceState(null, '', `/meghivo/${pretty}`);

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      $('copy').textContent = 'Kimásolva';
    } catch {
      getSelection()?.selectAllChildren($('code'));
    }
  });

  const { office, problem } = await officeOf(code);
  if (problem === 'invalid') return invalid();
  // Busy or offline: the code still works in the app, only the office's name is missing here.
  $('title').textContent = office ? `${office} meghív a Trippóba` : 'A könyvelőd meghívott a Trippóba';
  if (office) document.title = `${office} meghívója | Trippo`;
}

main();

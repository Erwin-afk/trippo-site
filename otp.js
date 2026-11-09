/*
 * The e-mail code login shared by Útjaim (fiokom) and the könyvelői portál: e-mail → 6 boxes.
 * Expects in the page: <form id="email-form"> with <input id="email">, <div id="code-step">,
 * and <p id="login-error">. Everything typed by the person goes in as text, never as HTML.
 */

const LENGTH = 6; // supabase/config.toml otp_length
const RESEND_SECONDS = 60;

/** Webmail by domain, so "open your mail" can go straight to the inbox. */
const WEBMAIL = [
  [['gmail.com', 'googlemail.com'], 'Gmail', 'https://mail.google.com/'],
  [['outlook.com', 'outlook.hu', 'hotmail.com', 'hotmail.hu', 'live.com', 'msn.com'], 'Outlook', 'https://outlook.live.com/mail/'],
  [['freemail.hu'], 'Freemail', 'https://freemail.hu/'],
  [['citromail.hu'], 'Citromail', 'https://www.citromail.hu/'],
  [['icloud.com', 'me.com', 'mac.com'], 'iCloud Mail', 'https://www.icloud.com/mail'],
  [['yahoo.com'], 'Yahoo Mail', 'https://mail.yahoo.com/'],
];
export const webmailFor = (email) => {
  const domain = String(email).split('@')[1]?.toLowerCase() ?? '';
  const hit = WEBMAIL.find(([domains]) => domains.includes(domain));
  return hit ? { name: hit[1], url: hit[2] } : null;
};

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
};

/** Six one-digit boxes: typing moves on, Backspace moves back, paste and autofill fill them all. */
function boxes(onComplete) {
  const group = el('div', { class: 'otp', role: 'group', 'aria-label': 'Belépőkód, 6 számjegy' });
  const inputs = Array.from({ length: LENGTH }, (_, i) =>
    el('input', {
      class: 'otp-box',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      // Only the first box offers the browser's one-time-code autofill; it spreads over the rest.
      autocomplete: i === 0 ? 'one-time-code' : 'off',
      'aria-label': `${i + 1}. számjegy`,
    }),
  );
  group.append(...inputs);
  const value = () => inputs.map((x) => x.value).join('');
  const fill = (digits, from = 0) => {
    digits.split('').slice(0, LENGTH - from).forEach((d, k) => (inputs[from + k].value = d));
    inputs.forEach((x) => x.classList.toggle('filled', !!x.value));
    const next = inputs.find((x) => !x.value);
    (next ?? inputs[LENGTH - 1]).focus();
    if (value().length === LENGTH) onComplete(value());
  };
  inputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      group.classList.remove('bad');
      const digits = input.value.replace(/\D/g, '');
      input.value = '';
      if (digits) fill(digits, digits.length >= LENGTH ? 0 : i);
      else input.classList.remove('filled');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        e.preventDefault();
        inputs[i - 1].value = '';
        inputs[i - 1].classList.remove('filled');
        inputs[i - 1].focus();
      } else if (e.key === 'ArrowLeft' && i > 0) inputs[i - 1].focus();
      else if (e.key === 'ArrowRight' && i < LENGTH - 1) inputs[i + 1].focus();
    });
    input.addEventListener('paste', (e) => {
      const digits = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
      if (!digits) return;
      e.preventDefault();
      group.classList.remove('bad');
      fill(digits, digits.length >= LENGTH ? 0 : i);
    });
    input.addEventListener('focus', () => input.select());
  });
  return {
    group,
    focus: () => (inputs.find((x) => !x.value) ?? inputs[0]).focus(),
    paste: (text) => {
      const digits = String(text).replace(/\D/g, '');
      if (digits.length !== LENGTH) return false;
      fill(digits);
      return true;
    },
    busy: (on) => {
      group.classList.toggle('busy', on);
      inputs.forEach((x) => (x.disabled = on));
    },
    wrong: () => {
      inputs.forEach((x) => {
        x.value = '';
        x.classList.remove('filled');
      });
      group.classList.remove('bad');
      void group.offsetWidth; // restart the shake
      group.classList.add('bad');
      inputs[0].focus();
    },
  };
}

/**
 * Wires the login card. `send(email)` and `verify(email, code)` return an error text or null;
 * `done()` runs after a good code.
 */
export function setupLogin({ send, verify, done }) {
  const form = document.getElementById('email-form');
  const emailInput = document.getElementById('email');
  const step = document.getElementById('code-step');
  const errorBox = document.getElementById('login-error');
  let email = '';
  let timer = null;

  const fail = (text) => {
    errorBox.textContent = text;
    errorBox.classList.remove('hidden');
  };
  const clearError = () => errorBox.classList.add('hidden');

  const showEmail = () => {
    clearInterval(timer);
    step.classList.add('hidden');
    step.after(errorBox); // back under the card content, before the boxes are dropped
    step.replaceChildren();
    form.classList.remove('hidden');
    clearError();
    emailInput.focus();
    emailInput.select();
  };

  const showCode = () => {
    form.classList.add('hidden');
    clearError();
    let otp;
    const verifyCode = async (code) => {
      otp.busy(true);
      checking.classList.remove('hidden');
      const err = await verify(email, code);
      otp.busy(false);
      checking.classList.add('hidden');
      if (err) {
        fail(err);
        otp.wrong();
      } else done();
    };
    otp = boxes(verifyCode);

    const chip = el('button', { type: 'button', class: 'email-chip', 'aria-label': `${email}, e-mail-cím javítása` }, [el('span', { text: email }), el('span', { class: 'pencil', 'aria-hidden': 'true', text: '✎' })]);
    chip.addEventListener('click', showEmail);

    const checking = el('p', { class: 'checking hidden', text: 'Ellenőrzés…' });
    const helpers = el('div', { class: 'otp-helpers' });
    const mail = webmailFor(email);
    if (mail) helpers.append(el('a', { class: 'otp-chip', href: mail.url, target: '_blank', rel: 'noopener noreferrer', text: `${mail.name} megnyitása` }));
    if (navigator.clipboard?.readText) {
      const paste = el('button', { type: 'button', class: 'otp-chip', text: 'Beillesztés' });
      paste.addEventListener('click', async () => {
        try {
          if (!otp.paste(await navigator.clipboard.readText())) fail('A vágólapon nincs 6 jegyű kód. Másold ki a levélből, és próbáld újra.');
        } catch {
          fail('A böngésző nem engedte a beillesztést. Kattints az első mezőbe, és nyomd meg a Ctrl+V-t.');
        }
      });
      helpers.append(paste);
    }

    const resend = el('button', { type: 'button', class: 'resend' });
    const ring = el('span', { class: 'ring', 'aria-hidden': 'true' });
    const label = el('span');
    resend.append(ring, label);
    const tick = (left) => {
      resend.disabled = left > 0;
      ring.style.setProperty('--left', String(left / RESEND_SECONDS));
      ring.classList.toggle('hidden', left <= 0);
      label.textContent = left > 0 ? `Új kódot ${left} mp múlva kérhetsz` : '↻ Új kód küldése';
    };
    const countdown = () => {
      let left = RESEND_SECONDS;
      tick(left);
      clearInterval(timer);
      timer = setInterval(() => {
        left -= 1;
        tick(left);
        if (left <= 0) clearInterval(timer);
      }, 1000);
    };
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      const err = await send(email);
      if (err) {
        fail(err);
        tick(0);
      } else {
        clearError();
        countdown();
        otp.focus();
      }
    });

    step.replaceChildren(
      el('p', { class: 'muted', text: 'A 6 jegyű kódot ide küldtük:' }),
      chip,
      otp.group,
      checking,
      helpers,
      el('p', { class: 'muted small', text: 'A kód 1 óráig érvényes. Nem jött meg pár perc alatt? Nézd meg a Spam vagy a Promóciók mappát is.' }),
      resend,
    );
    // The message belongs next to the boxes it is about.
    checking.after(errorBox);
    step.classList.remove('hidden');
    countdown();
    otp.focus();
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = form.querySelector('button');
    // A slow network must not look frozen.
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Küldés…';
    clearError();
    email = emailInput.value.trim().toLowerCase();
    const err = await send(email);
    button.disabled = false;
    button.textContent = label;
    if (err) return fail(err);
    showCode();
  });
}

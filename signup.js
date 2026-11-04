'use strict';
/* Newsletter sign-up on the homepage. The newsletter function mails a confirmation; nothing is
   subscribed until its button on hirlevel.html is pressed. */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signup');
  if (!form) return;
  const message = document.getElementById('signup-message');
  const button = form.querySelector('button');
  const say = (text) => {
    message.textContent = text;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) return say('Ez nem tűnik e-mail-címnek.');
    button.disabled = true;
    try {
      const res = await fetch('https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribe: email, website: form.website.value, source: 'home' }),
      });
      const { status } = await res.json();
      if (status === 'check') {
        say('Küldtünk egy levelet. A benne lévő gombbal erősítsd meg a feliratkozást.');
        form.email.value = '';
      } else if (status === 'invalid') say('Ez nem tűnik e-mail-címnek.');
      else say('Most nem sikerült. Próbáld újra később.');
    } catch {
      say('Most nem sikerült. Van internet?');
    } finally {
      button.disabled = false;
    }
  });
});

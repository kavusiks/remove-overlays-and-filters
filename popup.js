const statusEl = document.getElementById('status');
const rulesSection = document.getElementById('rules-section');
const rulesList = document.getElementById('rules');
const actionButtons = document.querySelectorAll('.actions button');

const pluralize = (count) => `${count} element${count === 1 ? '' : 's'}`;

async function renderRules(host) {
  const { rules = {} } = await chrome.storage.local.get('rules');
  const siteRules = rules[host] || [];

  rulesSection.hidden = siteRules.length === 0;
  document.getElementById('rules-host').textContent = host;
  rulesList.replaceChildren(
    ...siteRules.map((rule) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = rule.label;
      label.title = rule.selector;

      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = '×';
      undo.title = 'Show this element again';
      undo.setAttribute('aria-label', `Show ${rule.label} again`);
      undo.addEventListener('click', () => removeRule(host, rule.selector));

      item.append(label, undo);
      return item;
    }),
  );
}

async function removeRule(host, selector) {
  const { rules = {} } = await chrome.storage.local.get('rules');
  rules[host] = (rules[host] || []).filter((rule) => rule.selector !== selector);
  if (rules[host].length === 0) delete rules[host];
  await chrome.storage.local.set({ rules });
  await renderRules(host);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let host;
  try {
    ({ host } = await chrome.tabs.sendMessage(tab.id, { type: 'getHost' }, { frameId: 0 }));
  } catch {
    actionButtons.forEach((button) => {
      button.disabled = true;
    });
    statusEl.textContent = "Can't run here. Chrome blocks extensions on its own pages and the Web Store. On a regular site, reload the tab and try again.";
    return;
  }

  document.getElementById('remove-blur').addEventListener('click', async () => {
    const { count } = await chrome.tabs.sendMessage(tab.id, { type: 'removeBlur' });
    statusEl.textContent = count
      ? `Removed blur from ${pluralize(count)}. Staying on until reload.`
      : 'No blurred text found in the main page. Watching for new blur until reload.';
  });

  document.getElementById('enable-scrolling').addEventListener('click', async () => {
    const { count } = await chrome.tabs.sendMessage(tab.id, { type: 'enableScrolling' });
    statusEl.textContent = count
      ? `Unlocked scrolling on ${pluralize(count)}. Staying on until reload.`
      : 'No CSS scroll lock found in the main page. Watching for new locks until reload.';
  });

  document.getElementById('start-picker').addEventListener('click', async () => {
    await chrome.tabs.sendMessage(tab.id, { type: 'startPicker' }, { frameId: 0 });
    window.close();
  });

  await renderRules(host);
}

init();

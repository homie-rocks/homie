import app from '../app.json';
import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
import { createShop, type ShopCatalog } from '@homie-rocks/studio/shop';
const room = openRoom<typeof rules>();
const shop = createShop();
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const action = $<HTMLButtonElement>('[data-action]');
const choice = $<HTMLSelectElement>('#choice');
const frequency = $<HTMLSelectElement>('#monthly');
let catalog: ShopCatalog | undefined, busy = false;
document.body.className = room.net.params.role ?? 'customer';
document.body.style.setProperty('--tone', app.starter.color);
$('h1').textContent = app.name;
$('#intro').textContent = app.blurb;
$('#label').textContent = 'Your gift';
$('#choice-label').textContent = 'Choose a gift';
$('#frequency-label').textContent = 'Gift frequency';
$('#once').textContent = 'One time'; $('#month').textContent = 'Monthly';
$('#giving-link').textContent = 'Manage my gifts';
$('#goal').hidden = true;
$('#entries').hidden = true;
$('#prompt').textContent = 'Choose what works for you. Payments go directly to our Stripe account.';
const amountLabel = document.createElement('label'); amountLabel.textContent = 'Your amount';
const amount = document.createElement('input'); amount.type = 'number'; amount.inputMode = 'decimal'; amountLabel.append(amount);
choice.parentElement!.after(amountLabel);
function selected() { return catalog?.items.find(i => i.id === choice.value); }
function paint() {
 const item = selected();
 amountLabel.hidden = item?.price !== 'choose';
 action.disabled = busy || !catalog?.open || !item || item.way === 'closed';
 action.textContent = frequency.value === 'month' ? 'Give monthly on Stripe' : 'Give on Stripe';
 $('[data-count]').textContent = item?.shown ?? 'Preview';
 if (item?.price === 'choose') {
  const scale = catalog!.currencyScale;
  amount.min = String((item.min ?? 0) / scale);
  amount.max = item.max == null ? '' : String(item.max / scale);
  amount.step = String(1 / scale);
 }
}
function options() {
 choice.replaceChildren();
 for (const item of catalog?.items ?? []) {
  if (item.kind !== 'donation' || Boolean(item.interval) !== (frequency.value === 'month')) continue;
  const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} · ${item.shown}`; choice.append(option);
 }
 paint();
}
choice.onchange = paint; frequency.onchange = options;
action.onclick = async () => {
 const item = selected(); if (!item || !catalog?.open) return;
 const value = item.price === 'choose' ? Math.round(Number(amount.value) * catalog.currencyScale) : undefined;
 if (item.price === 'choose' && (!amount.value || !Number.isSafeInteger(value) || value! < (item.min ?? 0) || item.max != null && value! > item.max)) {
  $('#status').textContent = 'Enter an amount within the displayed range.'; return;
 }
 busy = true; paint();
 try {
  // Opening Checkout is not a payment. Only Stripe's verified webhook records a gift.
  const opened = await shop.buy(item.id, 1, value);
  $('#status').textContent = opened ? 'Finish your gift on Stripe. Your receipt confirms payment.' : 'Open the shop to sign in or complete the steps for this gift.';
  if (!opened) shop.open(item.id);
 } finally { busy = false; paint(); }
};
async function refresh() {
 catalog = await shop.catalog(); options();
 $('#status').textContent = catalog.open ? 'Monthly gifts renew until you cancel through Stripe. Manage your gifts using the link below.' : 'Preview — giving is unavailable until the organisation connects Stripe.';
 $('#connection').textContent = room.net.link === 'online' ? 'Together · live' : 'Connecting…';
 room.net.playable();
}
shop.on('closed', () => { void refresh(); });
void refresh();

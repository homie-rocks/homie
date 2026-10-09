export const officeScript = String.raw`      if (s.purchases) {
        top.appendChild(el('h3', null, 'Machine payment readiness'));
        (s.purchases.missing || []).forEach(function (reason) { top.appendChild(el('p', null, reason)); });
        var exchange = s.purchases.exchange;
        if (exchange) top.appendChild(el('p', null, exchange.verified ? exchange.scope : exchange.reason));
      }
      var recoveries = (s.settlementRecovery || []).concat(s.paymentRecovery || []);
      if (recoveries.length) {
        top.appendChild(el('h3', null, 'Payment recovery'));
        recoveries.forEach(function (job) {
          top.appendChild(el('p', null, job.order_id + ' · ' + (job.network || 'Stripe') + ' · ' + job.state + (job.request_key ? ' · request ' + job.request_key : '') + (job.payment ? ' · payment ' + job.payment : '') + (job.started_at ? ' · since ' + new Date(job.started_at).toISOString() : '') + (job.error ? ' · ' + job.error : '')));
          if (job.request_key && job.payment) {
            var cancel = el('button', { type: 'button' }, 'Cancel if unpaid');
            cancel.addEventListener('click', function () {
              if (!confirm('Read this payment from Stripe and cancel it only if it has not succeeded? A paid order stays paid and can be refunded separately.')) return;
              cancel.disabled = true;
              api('POST', '/_studio/api/shop/reconcile-payments', { order: job.order_id, cancel: true }).then(function (result) { if (!result.ok) throw new Error(result.message || 'Reconciliation failed'); load(); }).catch(function (error) { cancel.disabled = false; toast(error.message); });
            });
            top.appendChild(cancel);
          }
          if (job.request_key && !job.payment) {
            var payment = el('input', { placeholder: 'Existing Stripe PaymentIntent id', 'aria-label': 'Existing Stripe PaymentIntent id' });
            var read = el('button', { type: 'button' }, 'Read this payment');
            read.addEventListener('click', function () {
              read.disabled = true;
              api('POST', '/_studio/api/shop/reconcile-payments', { order: job.order_id, payment: payment.value.trim() }).then(function (result) { if (!result.ok) throw new Error(result.message || 'Read failed'); load(); }).catch(function (error) { read.disabled = false; toast(error.message); });
            });
            top.appendChild(payment); top.appendChild(read);
          }
        });
        var reconcile = el('button', { type: 'button' }, 'Reconcile payments now');
        reconcile.addEventListener('click', function () {
          reconcile.disabled = true;
          api('POST', '/_studio/api/shop/reconcile-payments', {}).then(function (result) { if (!result.ok) throw new Error(result.message || 'Reconciliation failed'); load(); }).catch(function (error) { reconcile.disabled = false; toast(error.message); });
        });
        top.appendChild(reconcile);
      }
`;

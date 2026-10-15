/** Public Stripe Apps permission names. Optional capability probes are classified separately and never added to the
 * App grant. Stripe enforces the credential scope; callers handle denied probes.
 * https://docs.stripe.com/stripe-apps/reference/permissions */
export const WORKER_PERMISSIONS = Object.freeze(['checkout_session_write','payment_intent_write','charge_write','dispute_read','subscription_write','invoice_read','customer_portal_write','product_read','plan_read']);
export const STRIPE_RESOURCES = Object.freeze({
 'checkout/sessions': ['checkout_session_write',['GET','POST']],
 payment_intents: ['payment_intent_write',['GET','POST']],
 charges: ['charge_write',['GET']], refunds: ['charge_write',['GET','POST']],
 disputes: ['dispute_read',['GET']], webhook_endpoints: [['GET','POST','DELETE']],
 subscriptions: ['subscription_write',['GET','POST','DELETE']], subscription_items: ['subscription_write',['GET']],
 invoices: ['invoice_read',['GET']], invoice_payments: ['invoice_read',['GET']],
 'billing_portal/sessions': ['customer_portal_write',['POST']],
 'billing_portal/configurations': ['customer_portal_write',['GET','POST']],
 products: ['product_read',['GET']], prices: ['plan_read',['GET']],
});
export const OPTIONAL_STRIPE_RESOURCES=Object.freeze(['/v2/network/business_profiles/me','/v1/crypto/deposit_addresses','/v1/payment_method_configurations']);
export function workerPermission(method,path) {
 const clean=path.split('?')[0];
 if(method==='GET' && clean==='/v1/account')return 'account_identity';
 const resource=Object.keys(STRIPE_RESOURCES).find(r=>clean==='/v1/'+r || clean.startsWith('/v1/'+r+'/'));
 const [permission,methods]=STRIPE_RESOURCES[resource]??[];
 return methods?.includes(method) && WORKER_PERMISSIONS.includes(permission) ? permission : null;
}

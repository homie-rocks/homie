// Step 1 has no approved Internet destinations. Bindings remain explicit capabilities.
export default {fetch() { return new Response('Managed egress denied', {status:403}); }};

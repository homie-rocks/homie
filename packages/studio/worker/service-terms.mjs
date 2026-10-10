/** Shared immutable terms for priced tools and their Stripe Payment Links. */
export const serviceTerms = (price) => ({billing:'one-time',scope:'service',updates:'none',source:false,commercialUse:true,transferable:false,onRefund:'terminate',onExpiry:'terminate',refund:'Ask the studio for a refund.',...price});

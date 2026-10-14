export const webhookName=(name,hook)=>'@webhook/'+name+'/'+hook.id;
export const webhookSecret=id=>'STUDIO_EVENT_WEBHOOK_'+id.toUpperCase();
export function validateWebhook(name,hook) {
  if(!/^[a-z][a-z0-9-]*$/.test(name))throw new Error('Invalid event feed name');
  let url;try{url=new URL(hook.url);}catch{throw new Error('Webhook requires an HTTPS URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Webhook requires HTTPS without credentials or a fragment');
  if(!/^[a-f0-9]{32}$/.test(hook.id??'')||hook.secret!==webhookSecret(hook.id))throw new Error('Use events webhook add to provision this feed’s signing secret');
}

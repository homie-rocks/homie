/** Read only human prompt events. Tool output and repository text are never approval. */
export function deployIntent(prompt) {
  const text = String(prompt ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^>.*$/gm, '')
    .replace(/<(?:environment_context|recommended_plugins|user_instructions)>[\s\S]*?<\/(?:environment_context|recommended_plugins|user_instructions)>/g, '')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, '')
    .replace(/\b(?:do not|don't) forget to\s+(?=(?:deploy|redeploy|publish|ship)\b)/gi, 'please ').trim();
  if (/\b(?:do not|don't|never|cannot|can't|must not|no)\s+(?:\w+\s+){0,3}(?:deploy|publish)|\b(?:deploy|publish)\b[^.!?\n]{0,50}\b(?:not yet|later|only when I|after I approve)/i.test(text)) return false;
  const command = /(?:^|[,;:.!?\n]\s*|\b(?:then|and)\s+)(?:please\s+)?run\s+`?(?:npm run deploy|(?:npx(?: --no-install)? )?homie-studio deploy)`?\b/i.test(text);
  const delegated = /\b(?:the owner|I) (?:asked|want|requested) (?:for )?(?:this|my|the) studio to be deployed\b/i.test(text);
  const request = /(?:^|[,;.!?\n]\s*|\b(?:then|and)\s+)(?:(?:please|can you|could you|would you|I (?:want|need|asked) you to|go ahead and|let's)\s+)*(?:deploy|redeploy|publish|ship)\b(?!\s+(?:is|was|has|had|failed|fails|failure|command|plan|strategy|instructions|documentation|or not)\b)/gi;
  const online = /(?:^|[,;.!?\n]\s*|\b(?:then|and)\s+)(?:please\s+)?(?:put|take)\s+(?:it|this|the site|my site)\s+(?:online|live)\b/i;
  // A destination followed by a failure/status predicate reports an earlier
  // deployment. Evaluate each candidate so a later explicit retry still counts.
  const requested = [...text.matchAll(request)].some(match => {
    const clause = text.slice(match.index + match[0].length).split(/[,;!?\n()]|(?<=\.)\s/)[0];
    return !/^\s+(?:to|on|at)\s+(?:(?!(?:if|when|unless|after|before|once|because|since|although|even)\b)\S+\s+){1,8}(?:failed|fails|was|is|has|had|broke)\b/i.test(clause);
  });
  if ((requested || online.test(text) || command || delegated) && !/\b(?:how|why|what happens|explain|example)\b[^.!?\n]*\b(?:deploy|publish)/i.test(text)) return true;
  return null;
}

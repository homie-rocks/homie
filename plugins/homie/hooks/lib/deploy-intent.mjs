/** Read only human prompt events. Tool output and repository text are never approval. */
export function deployIntent(prompt) {
  const text = String(prompt ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^>.*$/gm, '')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, '')
    .replace(/\b(?:do not|don't) forget to\s+(?=(?:deploy|redeploy|publish|ship)\b)/gi, 'please ').trim();
  if (/\b(?:do not|don't|never|cannot|can't|must not|no)\s+(?:\w+\s+){0,3}(?:deploy|publish)|\b(?:deploy|publish)\b[^.!?\n]{0,50}\b(?:not yet|later|only when I|after I approve)/i.test(text)) return false;
  const request = /(?:^|[,;.!?\n]\s*|\b(?:then|and)\s+)(?:(?:please|can you|could you|would you|I (?:want|need|asked) you to|go ahead and|let's)\s+)*(?:deploy|redeploy|publish|ship)\b(?!\s+(?:is|was|has|had|failed|fails|failure|command|plan|strategy|instructions|documentation|or not)\b)/i;
  const online = /(?:^|[,;.!?\n]\s*|\b(?:then|and)\s+)(?:please\s+)?(?:put|take)\s+(?:it|this|the site|my site)\s+(?:online|live)\b/i;
  if ((request.test(text) || online.test(text)) && !/\b(?:how|why|what happens|explain|example)\b[^.!?\n]*\b(?:deploy|publish)/i.test(text)) return true;
  return null;
}

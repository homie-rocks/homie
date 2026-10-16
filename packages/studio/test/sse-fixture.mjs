import {EventSourceParserStream} from 'eventsource-parser/stream';

// HTTP chunks can contain several frames, part of a frame, or part of a UTF-8
// character. Use the same SSE parser as the MCP SDK, preserving queued frames.
export function jsonSseReader(body) {
  return body.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({onError:'terminate'}))
    .pipeThrough(new TransformStream({transform(event,controller){controller.enqueue(JSON.parse(event.data));}}))
    .getReader();
}
export async function nextSseJson(reader) {
  const {done,value}=await reader.read();
  if(done)throw new Error('SSE ended before the expected message');
  return value;
}

/** Declarative tool references for Homie's media skills; host namespaces are resolved by the AI. */
export const MEDIA_WORKFLOWS = Object.freeze({
 art: { provider:'fal', tools:['recommend_model','get_model_schema','get_pricing','run_model','check_job','get_job_result','upload_file'] },
 models: { provider:'fal', tools:['recommend_model','get_model_schema','get_pricing','run_model','submit_job','check_job','get_job_result'] },
 video: { provider:'fal', tools:['recommend_model','get_model_schema','get_pricing','submit_job','check_job','get_job_result'] },
 style: { provider:'fal', tools:['recommend_model','get_model_schema','get_pricing','run_model','check_job','get_job_result'] },
 music: { provider:'elevenlabs', tools:['creative_get_flow_node_types','creative_get_model_guide','creative_get_flow_run_status'], generation:'discover from connected workspace schema' },
 sound: { provider:'elevenlabs', tools:['creative_get_flow_node_types','creative_get_model_guide','creative_get_flow_run_status'], generation:'discover from connected workspace schema' },
});
export function validateMediaTools(workflow, tools) {
 const available=new Set(tools.map(t=>t.name));
 return {ready:workflow.tools.every(t=>available.has(t)), missing:workflow.tools.filter(t=>!available.has(t))};
}

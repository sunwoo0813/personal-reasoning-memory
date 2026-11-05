import {createHash} from 'node:crypto';
// Bound page snapshots at the API boundary, including older queued events.
export function normalizeEvent(event) {
 if(event.event_type!=='page_view')return event;
 const input=event.content;
 const raw=typeof input==='string'?input:typeof input?.text==='string'?input.text:'';
 const text=raw.trim().slice(0,60000);
 const metadata={...event.metadata,truncated:!!event.metadata?.truncated||raw.trim().length>60000,content_length:text.length,content_hash:text?createHash('sha256').update(text).digest('hex'):null};
 if(!text)return {...event,content:null,metadata,capture_status:'metadata_only'};
 return {...event,content:{text,extracted_at:input?.extracted_at||null,extractor_version:input?.extractor_version||metadata.parser_version||'legacy'},metadata,capture_status:metadata.truncated?'partial':'complete'};
}

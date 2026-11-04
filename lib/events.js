// Older extensions may still have page snapshots queued for upload.
export function normalizeEvent(event) {
 if (event.event_type !== 'page_view') return event;
 const {truncated, ...metadata} = event.metadata || {};
 return {...event, content:null, metadata, capture_status:'metadata_only'};
}

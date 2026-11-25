import json, re, html, hashlib
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from collections import Counter
from fontTools.ttLib import TTFont as InspectFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf'
data = json.loads((ROOT / 'tmp/pdfs/session-export.json').read_text())
run, session, project = data['run'], data['session'], data['project']
events = [row['snapshot'] for row in data['inputs']]
episodes = sorted(run['episodes'], key=lambda e:e['sequence'])
assert len(events) == session['event_count'] == 22
event_codes = {e['id']:f'E{i:02d}' for i,e in enumerate(events,1)}
live = {e['id']:e for e in data['events']}
assert all(e['event_contents'] == live[e['id']]['event_contents'] for e in events)
objects = sum(len(e['reasoning_objects']) for e in episodes)
links = sum(len(o['object_evidence_links']) for e in episodes for o in e['reasoning_objects'])
types = {'question':'질문','evidence':'근거','hypothesis':'가설','insight':'발견','contradiction':'반론','decision':'결정','open_question':'미해결 질문'}
speakers = {'user':'사용자','assistant':'AI 응답','source':'웹 자료','unknown':'주체 미확인'}
event_types = {'page_view':'페이지 방문','search':'검색','llm_exchange':'ChatGPT 대화','copy_highlight':'선택·복사'}

fonts = [
 ('KR','/System/Library/Fonts/Supplemental/AppleGothic.ttf',0),
 ('KRBold','/System/Library/Fonts/Supplemental/AppleGothic.ttf',0),
 ('Unicode','/System/Library/Fonts/Supplemental/Arial Unicode.ttf',0),
 ('Symbols','/System/Library/Fonts/Apple Symbols.ttf',0),
]
cmaps = {}
for name,path,index in fonts:
 pdfmetrics.registerFont(TTFont(name,path,subfontIndex=index))
 cmaps[name] = InspectFont(path,fontNumber=index).getBestCmap()

def rich(text, bold=False):
 text = str(text).replace('\r\n','\n').replace('\r','\n')
 base = 'KRBold' if bold else 'KR'
 chunks=[]; current=None; buf=''
 for char in text:
  if char=='\n':
   if buf: chunks.append(f'<font name="{current}">{html.escape(buf)}</font>');buf=''
   current=None;chunks.append('<br/>');continue
  if char=='\t':char='    '
  selected = next((name for name in [base,'Unicode','Symbols'] if all(ord(c) in cmaps[name] or c.isspace() for c in char)),None)
  if selected is None:raise ValueError(f'Unsupported glyph {char!r}')
  if selected!=current and buf:
   chunks.append(f'<font name="{current}">{html.escape(buf)}</font>');buf=''
  current=selected;buf+=char
 if buf:chunks.append(f'<font name="{current}">{html.escape(buf)}</font>')
 return ''.join(chunks)

ink=colors.HexColor('#172334'); muted=colors.HexColor('#5C6A7B'); blue=colors.HexColor('#2057A6')
styles = {
 'title':ParagraphStyle('title',fontName='KRBold',fontSize=25,leading=35,textColor=ink,spaceAfter=15,wordWrap='CJK'),
 'h1':ParagraphStyle('h1',fontName='KRBold',fontSize=19,leading=28,textColor=blue,spaceAfter=16,wordWrap='CJK',keepWithNext=True),
 'h2':ParagraphStyle('h2',fontName='KRBold',fontSize=13,leading=20,textColor=ink,spaceBefore=12,spaceAfter=8,wordWrap='CJK',keepWithNext=True),
 'h3':ParagraphStyle('h3',fontName='KRBold',fontSize=10.5,leading=16,textColor=blue,spaceBefore=8,spaceAfter=5,wordWrap='CJK',keepWithNext=True),
 'body':ParagraphStyle('body',fontName='KR',fontSize=9.5,leading=15.5,textColor=ink,spaceAfter=7,wordWrap='CJK',splitLongWords=True),
 'small':ParagraphStyle('small',fontName='KR',fontSize=8,leading=12.5,textColor=muted,spaceAfter=5,wordWrap='CJK'),
 'quote':ParagraphStyle('quote',fontName='KR',fontSize=9,leading=15,textColor=ink,leftIndent=12,rightIndent=6,borderPadding=5,spaceAfter=7,wordWrap='CJK'),
 'source':ParagraphStyle('source',fontName='KR',fontSize=9,leading=14.3,textColor=ink,spaceAfter=5,wordWrap='CJK',splitLongWords=True),
}
story=[]; text_parts=[]; sections=[]

def add(text,style='body',anchor=None):
 markup=rich(text,style in ('title','h1','h2','h3'))
 if anchor:markup=f'<a name="{anchor}"/>'+markup
 story.append(Paragraph(markup,styles[style]));text_parts.append(str(text)+'\n')

def body(text,style='source'):
 # Preserve every character in the text companion; line groups keep the PDF
 # splittable even for full captured pages and long conversations.
 text=str(text)
 text_parts.append(text+'\n')
 for block in text.split('\n\n'):
  if block:story.append(Paragraph(rich(block),styles[style]))
  else:story.append(Spacer(1,4))

def js(value):return json.dumps(value,ensure_ascii=False,indent=2)
def local(value):
 if not value:return '없음'
 return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d %H:%M:%S KST')
def new_section(title,anchor):
 story.append(PageBreak());add(title,'h1',anchor);sections.append(title)

add('PRM 세션 평가 자료','title')
add('생각의 흐름 분석 + 수집 활동 전체','h2')
add(project['title'],'h2')
add(project.get('objective') or '프로젝트 목표 미입력')
add(f"세션: {local(session['started_at'])} - {local(session['ended_at'])}",'small')
add(f"분석 완료: {local(run['completed_at'])}",'small')
add(f"내보낸 시각: {local(data['exported_at'])}",'small')
story.append(Spacer(1,12))
stats=Table([[Paragraph(rich(f'{len(events)}개 기록',True),styles['h2']),Paragraph(rich(f'{len(episodes)}개 구간',True),styles['h2']),Paragraph(rich(f'{objects}개 사고 요소',True),styles['h2'])]],colWidths=[163,163,163])
stats.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#EDF3FB')),('BOX',(0,0),(-1,-1),0.4,colors.HexColor('#CCD9EC')),('LEFTPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
story.append(stats)
text_parts.append(f'기록 {len(events)}개 / 구간 {len(episodes)}개 / 사고 요소 {objects}개 / 근거 인용 {links}개\n')
add('자료 범위와 읽는 방법','h2')
add('1. 분석 결과: 구간 제목·목적·구분 이유와 모든 사고 요소, 발화 주체, 근거 인용을 수록했습니다.')
add('2. 원본 기록: 분석에 사용된 스냅샷 22개를 원래 순서대로 수록했습니다. 저장된 본문·검색어·질문·답변을 요약하거나 잘라내지 않았습니다.')
add('3. E01 같은 번호는 수집 기록 식별자입니다. 분석 결과의 근거 번호를 원본 기록과 대조할 수 있습니다. PDF 북마크에서도 각 구간과 기록으로 이동할 수 있습니다.')
add('4. 수집 당시 본문이 저장되지 않은 방문은 해당 사실을 표시했습니다. 저장되지 않은 내용은 재구성하지 않았습니다.')
add('인용문 일치는 확인됐지만, 사고 요소의 의미·분류·발화 주체·구간 구분이 타당한지는 평가 대상입니다. 이 문서는 분석 결과에 대한 별도 평가나 수정 내용을 추가하지 않은 내보내기 자료입니다.','small')
add('ChatGPT에 함께 전달할 요청 예시','h2')
add('첨부한 원본 기록과 자동 분석 결과를 비교해 평가해 주세요. 구간 구분의 타당성, 중요한 질문·근거·결정의 누락, 잘못된 사고 요소 분류, 사용자 발언과 AI 제안의 혼동, 인용이 해석을 뒷받침하는지를 확인해 주세요. 문제를 지적할 때는 구간 번호·사고 요소 번호·E번호를 제시하고, 원문에서 확인할 수 없는 부분은 확인 불가로 구분해 주세요.')

new_section('1. 세션 정보와 수집 기록 목록','overview')
add(f"프로젝트 ID: {project['id']}",'small')
add(f"세션 ID: {session['id']}",'small')
add(f"분석 Run ID: {run['id']}",'small')
add(f"모델: {run['model']} / 분석 버전: {run['pipeline_version']} / 상태: {run['status']}",'small')
add(f"기록 상태: {session['recording_status']} / 동기화: {session['sync_status']}",'small')
for e in events:
 code=event_codes[e['id']];title=e.get('metadata',{}).get('title') or e['source']
 add(f"{code} | {event_types[e['event_type']]} | {title}",'h3')
 add(f"{local(e['started_at'])} / 수집 상태: {e['capture_status']}",'small')
 url=e.get('source_ref',{}).get('url')
 if url:add(url,'small')

new_section('2. 생각의 흐름 분석 전체','analysis')
for ep in episodes:
 code=f"EP{ep['sequence']:02d}"
 add(f"{code}. {ep['title']}",'h2',code)
 add('목적','h3');add(ep['goal'])
 add('구분 이유','h3');add(ep['boundary_reason'])
 assigned=[link['event_id'] for link in sorted(ep['episode_event_links'],key=lambda x:x['position'])]
 add('포함 기록: '+', '.join(event_codes[eid] for eid in assigned),'small')
 # UUID insertion order preserves the UI's saved array order from this export.
 for number,item in enumerate(ep['reasoning_objects'],1):
  item_code=f'{code}-O{number:02d}'
  add(f"{item_code} | {types[item['type']]} | {speakers[item['speaker']]}",'h3')
  add(item['text'])
  for j,ref in enumerate(item['object_evidence_links'],1):
   event_code=event_codes[ref['event_id']]
   add(f"근거 {j}: {event_code} / 필드: {ref['field']} / 검증: {ref.get('verification_status','quote_matched')}",'small')
   body(ref['quote'],'quote')
  add(f"사고 요소 ID: {item['id']}",'small')
 if not ep['reasoning_objects']:add('원문으로 뒷받침되는 사고 요소가 없습니다.')

new_section('3. 수집 활동 전체 원문','originals')
add('다음은 분석 당시 고정된 원본 스냅샷입니다. 현재 DB에 저장된 22개 이벤트의 본문과도 일치함을 확인했습니다. 각 기록의 content_jsonb에 저장된 모든 필드를 출력했습니다.','small')
for index,e in enumerate(events):
 if index:story.append(PageBreak())
 code=event_codes[e['id']]
 title=e.get('metadata',{}).get('title') or e['source']
 add(f"{code}. {event_types[e['event_type']]} - {title}",'h2',f'event-{code}')
 add(f"이벤트 ID: {e['id']} / 원본 순번: {e['client_seq']}",'small')
 add(f"시작: {local(e['started_at'])} / 종료: {local(e['ended_at'])}",'small')
 add(f"출처: {e['source']} / 수집 상태: {e['capture_status']}",'small')
 add('출처 참조','h3');body(js(e.get('source_ref',{})))
 contents=e.get('event_contents') or {}
 value=contents.get('content_jsonb')
 add('저장된 내용 전체','h3')
 if isinstance(value,dict):
  if not value:add('저장된 본문이 없습니다.')
  for key,v in value.items():
   add(key,'h3')
   body(v if isinstance(v,str) else js(v))
 elif isinstance(value,str):body(value)
 elif value is None:add('저장된 본문이 없습니다. 방문 정보만 수집된 기록일 수 있습니다.')
 else:body(js(value))
 add('수집 메타데이터 전체','h3');body(js(e.get('metadata',{})))
 add('본문 저장 정보','h3');body(js({k:v for k,v in contents.items() if k!='content_jsonb'}))
 add('기타 이벤트 필드','h3');body(js({k:v for k,v in e.items() if k not in ['id','client_seq','event_type','started_at','ended_at','source','source_ref','capture_status','event_contents','metadata']}))

new_section('4. 내보내기 검증 정보','verification')
add(f'수집 기록 {len(events)}개, 분석 구간 {len(episodes)}개, 사고 요소 {objects}개, 근거 인용 {links}개를 수록했습니다.')
assigned=[l['event_id'] for ep in episodes for l in sorted(ep['episode_event_links'],key=lambda x:x['position'])]
assert assigned==[e['id'] for e in events]
refs=[ref for ep in episodes for item in ep['reasoning_objects'] for ref in item['object_evidence_links']]
for ref in refs:
 event=next(e for e in events if e['id']==ref['event_id'])
 v=event['event_contents']['content_jsonb']
 field=v if isinstance(v,str) and ref['field']=='text' else v.get(ref['field'])
 assert isinstance(field,str) and ref['quote'] in field
add('검증: 모든 이벤트가 원래 순서대로 정확히 한 구간에 포함됩니다. 모든 근거 인용은 연결된 원문 필드의 실제 부분 문자열입니다.')
add('프로젝트 정보 전체','h3');body(js(project))
add('세션 정보 전체','h3');body(js(session))
add('분석 실행 정보','h3');body(js({k:v for k,v in run.items() if k!='episodes'}))
add('분석 단계별 사용량','h3');body(js(data['steps']))

class PacketDoc(SimpleDocTemplate):
 def afterFlowable(self,flowable):
  if isinstance(flowable,Paragraph) and flowable.style.name in ('h1','h2'):
   label=flowable.getPlainText()
   if flowable.style.name=='h1' or label.startswith(('EP','E0','E1','E2')):
    key='bookmark-'+str(self.seq.nextf('bookmark'))
    self.canv.bookmarkPage(key)
    self.canv.addOutlineEntry(label,key,level=0 if flowable.style.name=='h1' else 1,closed=False)

def footer(canvas,doc):
 canvas.saveState();w,h=A4
 canvas.setStrokeColor(colors.HexColor('#DCE3EC'));canvas.line(48,42,w-48,42)
 canvas.setFont('KR',8);canvas.setFillColor(muted)
 canvas.drawString(48,29,'PRM | 세션 원본 및 분석 결과 | 2026-11-18')
 canvas.drawRightString(w-48,29,str(doc.page));canvas.restoreState()

pdf=OUT/'prm-session-review-2026-11-18.pdf'
doc=PacketDoc(str(pdf),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=48,bottomMargin=58,title='PRM 생각의 흐름 분석 및 수집 활동 전체',author='PRM session export')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
(OUT/'prm-session-review-2026-11-18.txt').write_text('\n'.join(text_parts),encoding='utf-8')
(OUT/'prm-session-review-2026-11-18.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(pdf),'events':len(events),'episodes':len(episodes),'objects':objects,'evidence':links,'pdf_bytes':pdf.stat().st_size},ensure_ascii=False))

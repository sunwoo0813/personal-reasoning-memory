# PRM E2E TEST 01 — 전체 분석 파이프라인 재검증

작성일: 2026-11-19 (Asia/Seoul)

**전체 파이프라인은 실패했다.** EP01이 원문 인용 검증을 3회 모두 통과하지 못해 EP02에 도달하지 않았다. 이후 동일한 Extraction을 EP02에 독립 적용한 진단은 성공했고 6개 객체·6개 참조를 검증했다. **EP01 마지막 후보 13개와 EP02 진단 6개를 합쳐 정상 결과 19개로 보고하지 않는다.**

## 1. 실행 조건과 보존 확인

- 기존 Run: `c4bbd6f5-77d4-4a55-a5b3-7d3f1c410061`
- 새 전체 로컬 평가 Run: `8a628d31-01de-4ec8-a733-d3c6708ba997` — failed
- 독립 EP02 진단 Run: `f6423cee-1ce4-4be4-9b08-c7e9fdea7a40` — complete
- 동일 원본 스냅샷 22개, gpt-5-mini, 기존 extraction-v1 코드·프롬프트·검증·최대 두 번 교정 유지
- 이전에 검증된 purpose-v2 체크포인트의 EP01=E01–E19, EP02=E20–E22를 재사용. 이번에는 Segmentation 모델을 다시 호출하지 않음
- Ground Truth 14개와 평가 방식을 모델 호출 전에 protocol.json / ground-truth.json에 고정
- DB 쓰기 없음. 전체 실행 전후 기존 프로젝트·세션·이벤트·본문·Run·스냅샷·체크포인트 상태 해시 일치
- 독립 EP02 진단은 고정된 로컬 스냅샷만 읽고 DB를 호출하지 않음
- 분석 관련 파일 5개의 시작·종료·보고서 생성 시 SHA-256 일치. 생산 Extraction 코드는 이번 작업에서 수정하지 않음
- 기존 npm test 64개 통과. 검증기가 실패 출력을 정상 완료로 처리하지 않은 것은 정상 동작

## 2. 기존 결과와 비교

| 평가 항목 | 기존 정상 Run | 새 전체 실행 | EP02 독립 진단 |
|---|---|---|---|
| Episode 개수 | 4 | 입력 2개 고정; 전체 추출 실패 | 고정 EP02 1개 |
| Reasoning Object 개수 | 35 | 정상 완료 결과 없음. EP01 최종 후보 13개 전부 미수락 | 검증 완료 6개 |
| 주요 사용자 가설 회수 | user/hypothesis 0/1. 사용자 question에 발언 자체는 존재 | 최종 품질 채점 불가. 거부 후보에서도 user/hypothesis 0개 | EP01 대상이므로 평가 범위 아님 |
| 주요 사용자 저장소 결정 회수 | 1/1. 같은 객체에 채택·기각 사실 모두 존재 | 검증된 회수 0/1: EP01 실행 실패. 의미 인식 능력의 0점으로 단정하지 않음 | 회원가입 판단 보류 객체 1개; 저장소 결정 회수와 합산하지 않음 |
| Open Question 정확성 | 사용자 객체 1/3 적절, 검색 오분류 2개. 별도 AI 질문 1개는 시점 해석 유보 | 최종 채점 불가. 거부 후보에 E18 과거 미결정 상태가 남음 | 회원가입 미해결 의미 회수. user/open_question 0, assistant/open_question 1 |
| 확정된 잘못된 분류 개수 | 2개(검색→미해결 질문). 별도 사용자 가설 유형 누락 1건 | 정상 결과가 없어 산출 불가 | 확정 오분류 0; 분류 해석 유보 2건·user/open_question 커버리지 빈틈 별도 |
| 중복 또는 불필요 객체 | 중복 검토 후보 3개·부차적 세부 후보 8개 | 전체 정상 결과가 없어 산출 불가 | 목적 외 저장소 요약 객체 후보 1개 |
| 근거 인용 일치 | 정상 결과 36/36 | EP01 거부 후보: 8/9 → 15/16 → 13/15. 정상 결과 점수와 혼합 금지 | 정상 진단 6/6 |

인용 일치는 의미적 타당성의 증명이 아니다. 확정 오분류 수는 분명한 사례의 하한이며 모호한 분류와 단순 누락을 억지로 같은 분류 오류에 포함하지 않았다. 중복·부차적 세부 설명 수는 명시한 객체별 기준에 따른 검토 후보 수다.

## 3. 새 Episode와 객체 목록

### EP01 — 저장 방식 조사·가설·반론·최종 결정

전체 구간 실패. 아래 13개는 마지막 모델 응답의 진단용 후보일 뿐이며 정식 결과가 아니다. 개별 참조가 맞는 11개도 구간 전체 실패를 우회해 저장하지 않았다.

| ID | Type | Speaker | Text | 개별 원문 검증 |
|---|---|---|---|---|
| [D-EP01-A03-O01](key-objects-and-evidence.md#d-ep01-a03-o01) | question | user | 나는 개인용 메모 웹앱을 만들려고 해. 초기에는 혼자 사용하는 앱이고, 빠른 실행 속도와 간단한 구조가 중요해. 그래서 서버 없이 브라우저에 데이터를 저장하는 Offline-first 방식이 더 좋을 것 같아. 이 방식의 장단점을 설명해줘 | quote_matched |
| [D-EP01-A03-O02](key-objects-and-evidence.md#d-ep01-a03-o02) | question | user | MDN 문서를 보니 IndexedDB로 브라우저에 데이터를 저장할 수 있네. 그렇다면 초기 MVP에서는 별도 클라우드 데이터베이스 없이 IndexedDB만 사용하는게 합리적이라는 가설을 세울 수 있겠어. 이 판단에서 놓치고 있는 위험이 있을까? | quote_matched |
| [D-EP01-A03-O03](key-objects-and-evidence.md#d-ep01-a03-o03) | question | user | 그렇다면 차라리 처음부터 Cloud-first 방식으로 개발하는 건 어떨까? Supabase를 사용하는 방안도 함께 검토해줘. 단, 아직 어떤 방식을 선택할지는 결정하지 않았어 | quote_matched |
| [D-EP01-A03-O04](key-objects-and-evidence.md#d-ep01-a03-o04) | evidence | source | MDN IndexedDB 설명 | quote_matched |
| [D-EP01-A03-O05](key-objects-and-evidence.md#d-ep01-a03-o05) | evidence | source | web.dev IndexedDB 요약 | quote_matched |
| [D-EP01-A03-O06](key-objects-and-evidence.md#d-ep01-a03-o06) | evidence | source | 브라우저 저장 기본 정책 | quote_matched |
| [D-EP01-A03-O07](key-objects-and-evidence.md#d-ep01-a03-o07) | insight | assistant | 개인용 메모 웹앱이라면 Offline-first 방식은 충분히 합리적인 선택이야. 특히 초기 사용자가 본인 한 명이고, 빠른 실행 속도와 단순한 구조를 중요하게 생각한다면 서버 기반 아키텍처보다 유리한 부분이 많아. | quote_matched |
| [D-EP01-A03-O08](key-objects-and-evidence.md#d-ep01-a03-o08) | insight | assistant | 현재 요구사항이라면 초기에는 서버 없이 IndexedDB를 중심으로 개발하는 것이 적절해. | quote_matched |
| [D-EP01-A03-O09](key-objects-and-evidence.md#d-ep01-a03-o09) | insight | assistant | 초기에는 IndexedDB만으로 시작하되, 실제 사용을 통해 데이터 보존의 중요성과 여러 기기에서 사용할 필요성을 검증한 뒤 클라우드 동기화 도입 여부를 결정하는 것이 합리적이다. | validation_failed |
| [D-EP01-A03-O10](key-objects-and-evidence.md#d-ep01-a03-o10) | insight | assistant | IndexedDB를 로컬 저장 계층으로 유지하고 클라우드 DB를 결합하면, 빠른 응답성과 오프라인 사용성을 유지하면서 기기 간 동기화와 데이터 보존 문제를 개선할 수 있다. | quote_matched |
| [D-EP01-A03-O11](key-objects-and-evidence.md#d-ep01-a03-o11) | contradiction | assistant | Assistant의 초기 권고(IndexedDB 단독 권장)와 이후 권고(클라우드 결합 권장) 간의 차이 | quote_matched |
| [D-EP01-A03-O12](key-objects-and-evidence.md#d-ep01-a03-o12) | decision | user | 최종적으로 결정했어. MVP에서는 Supabase를 메인 데이터 저장소로 사용하고, IndexedDB는 오프라인 임시 저장과 캐시에 활용할게. 처음 생각했던 IndexedDB 단독 방식은 기기 간 동기화와 데이터 보존 요구사항 때문에 채택하지 않겠어 | validation_failed |
| [D-EP01-A03-O13](key-objects-and-evidence.md#d-ep01-a03-o13) | open_question | user | 단, 아직 어떤 방식을 선택할지는 결정하지 않았어 | quote_matched |

### EP02 — 회원가입 검토·미해결 유지

독립 진단만 완료했다. 각 요청은 기존 전체 분석이 EP02에 도달했을 때와 동일한 제목·해당 원본·모델·Extraction 프롬프트를 사용한다. 전역 목적 검토를 새로 수행하거나 앞선 실패를 덮어쓰지 않았다.

| ID | Type | Speaker | Text |
|---|---|---|---|
| [N-EP02-O01](key-objects-and-evidence.md#n-ep02-o01) | question | user | 저장 방식에 대한 결정은 끝났어. 이제 다른 문제를 고민할게. 이 개인 메모 앱의 MVP에 회원가입 기능을 넣어야 할까? 사용자 경험과 개발 복잡도를 기준으로 비교해줘. 아직 결정하지는 않을거야 |
| [N-EP02-O02](key-objects-and-evidence.md#n-ep02-o02) | evidence | assistant | B. 본인 계정만 로그인  현재 가장 유력 개인용이라는 조건과 데이터 보안을 동시에 만족시키면서 구현 범위를 줄일 수 있어. 인증 기능을 완전히 없애지 않아 기기 변경에도 대응하기 쉬워. |
| [N-EP02-O03](key-objects-and-evidence.md#n-ep02-o03) | insight | assistant | 회원가입 UI는 선택 사항으로 두되, 데이터 모델에는 사용자 식별 체계를 처음부터 포함하는 방향이 합리적이야. |
| [N-EP02-O04](key-objects-and-evidence.md#n-ep02-o04) | evidence | assistant | Supabase  IndexedDB (오프라인 임시 저장 및 캐시) |
| [N-EP02-O05](key-objects-and-evidence.md#n-ep02-o05) | open_question | assistant | 미해결 질문: 회원가입 기능이 필요한가? |
| [N-EP02-O06](key-objects-and-evidence.md#n-ep02-o06) | decision | user | 회원가입은 아직 결정하지 않을게. 다음에 실제 사용자 테스트를 한 뒤 다시 판단하겠어. 지금은 이 질문을 미해결 상태로 남겨두자. |

## 4. 사전 정의 Ground Truth 대조

동일한 객체가 여러 의미 기준을 충족할 수 있다. 단, 사용자 가설 항목은 요청에 따라 user/hypothesis 유형과 E16.question 직접 근거까지 별도 확인했다. 기존 결과의 의미 기준은 13개 회수·1개 부분 회수로 보지만, 이는 전체 객체 의미 정확도 13/14라는 뜻이 아니다.

| 기준 | 기존 | 새 검증 결과 | 근거/진단 |
|---|---|---|---|
| EP01-01 초기 질문: 어떤 데이터 저장 방식을 선택할 것인가? | 의미 회수 | EP01 실패로 정식 채점 불가 | 표현됨; 전체 EP01 거부로 정식 회수 판정 제외 ([D-EP01-A03-O01](key-objects-and-evidence.md#d-ep01-a03-o01)) |
| EP01-02 초기 선호: Offline-first 및 서버 없는 로컬 저장 선호 | 의미 회수 | EP01 실패로 정식 채점 불가 | 초기 선호가 사용자 question 객체의 전문 안에 표현됨 ([D-EP01-A03-O01](key-objects-and-evidence.md#d-ep01-a03-o01)) |
| EP01-03 사용자 가설: IndexedDB 단독 저장으로 MVP 구현 가능 | 부분 회수: 사용자 가설 유형 누락 | EP01 실패로 정식 채점 불가 | 사용자 발언은 question에 남지만 user/hypothesis 객체 없음. 기존도 assistant/hypothesis가 별도로 있고 사용자 가설은 question에 포함됨 ([D-EP01-A03-O02](key-objects-and-evidence.md#d-ep01-a03-o02)) |
| EP01-04 근거: IndexedDB의 로컬 데이터 저장 기능 | 의미 회수 | EP01 실패로 정식 채점 불가 | 로컬 구조화 데이터 저장 기능의 원문 근거 표현됨 ([D-EP01-A03-O04](key-objects-and-evidence.md#d-ep01-a03-o04), [D-EP01-A03-O05](key-objects-and-evidence.md#d-ep01-a03-o05)) |
| EP01-05 반론: 데이터 보존 위험 및 기기 간 동기화 한계 | 의미 회수 | EP01 실패로 정식 채점 불가 | 보존 위험 근거와 동기화 개선 제안은 있지만 사용자의 위험 인식 E17은 개별 객체로 없음 ([D-EP01-A03-O06](key-objects-and-evidence.md#d-ep01-a03-o06), [D-EP01-A03-O10](key-objects-and-evidence.md#d-ep01-a03-o10)) |
| EP01-06 생각 변화: IndexedDB 단독 방식 재검토 | 의미 회수 | EP01 실패로 정식 채점 불가 | 사용자 생각 변화가 아닌 AI 권고 변화만 contradiction으로 표현. E17.question 직접 근거 객체 없음 ([D-EP01-A03-O11](key-objects-and-evidence.md#d-ep01-a03-o11)) |
| EP01-07 검토 대안: Cloud-first 및 Supabase | 의미 회수 | EP01 실패로 정식 채점 불가 | 사용자의 미확정 Cloud-first/Supabase 검토가 표현됨 ([D-EP01-A03-O03](key-objects-and-evidence.md#d-ep01-a03-o03)) |
| EP01-08 최종 사용자 결정: Supabase 메인 + IndexedDB 보조 | 의미 회수 | EP01 실패로 정식 채점 불가 | 결정 의미는 표현했으나 E19 인용의 '메인 데이터'를 '메인데이터'로 바꿔 증거 검증 실패 ([D-EP01-A03-O12](key-objects-and-evidence.md#d-ep01-a03-o12)) |
| EP01-09 기각된 대안: IndexedDB 단독 저장 | 의미 회수 | EP01 실패로 정식 채점 불가 | IndexedDB 단독 기각의 의미는 같은 결정 객체 안에 있으나 해당 객체의 인용 검증 실패 ([D-EP01-A03-O12](key-objects-and-evidence.md#d-ep01-a03-o12)) |
| EP02-01 새로운 질문: MVP 회원가입 기능 필요 여부 | 의미 회수 | EP02 독립 진단 의미 회수 | 새 질문과 이전 저장 문제 종료를 사용자 원문으로 보존 ([N-EP02-O01](key-objects-and-evidence.md#n-ep02-o01)) |
| EP02-02 평가 기준: 사용자 경험과 개발 복잡도 | 의미 회수 | EP02 독립 진단 의미 회수 | UX·개발 복잡도가 사용자 질문 전문에 들어 있으므로 별도 객체가 없어도 의미 회수 ([N-EP02-O01](key-objects-and-evidence.md#n-ep02-o01)) |
| EP02-03 사용자 판단: 아직 결정하지 않음 | 의미 회수 | EP02 독립 진단 의미 회수 | 미결정 유지·판단 보류를 정확히 표현. 도입/배제 확정으로 해석하지 않음 ([N-EP02-O01](key-objects-and-evidence.md#n-ep02-o01), [N-EP02-O06](key-objects-and-evidence.md#n-ep02-o06)) |
| EP02-04 미해결 질문: 회원가입 도입 여부 | 의미 회수 | EP02 독립 진단 의미 회수 | 미해결 의미는 회수. 다만 open_question은 assistant이고 user/open_question은 0개. 사용자의 보류 발언은 decision으로 표현 ([N-EP02-O05](key-objects-and-evidence.md#n-ep02-o05), [N-EP02-O06](key-objects-and-evidence.md#n-ep02-o06)) |
| EP02-05 후속 조건: 실제 사용자 테스트 후 재검토 | 의미 회수 | EP02 독립 진단 의미 회수 | 실제 사용자 테스트 후 재판단 조건을 사용자 원문으로 보존 ([N-EP02-O06](key-objects-and-evidence.md#n-ep02-o06)) |

## 5. 개선 확인과 남은 오류

- 분할 입력에서는 최초 질문과 관련 조사 맥락이 E01–E19로 유지되고, E20–E22가 별도 질문으로 보존됐다. 이번 평가에서는 이 분할을 고정했으므로 분할 정확도를 새로 측정한 것은 아니다.
- EP02 독립 진단은 미해결 회원가입 질문, UX·개발 복잡도, 사용자 테스트 이후 재검토를 의미적으로 회수했다. 회원가입 도입·배제를 확정했다는 오류는 관찰되지 않았다. 보류하기로 한 사용자 결정을 decision으로 분류하는 해석 자체는 가능하다.
- 전체 Extraction 품질이 기존보다 개선됐다고 결론 내릴 수 없다. EP01 검증 실패로 비교 가능한 새 전체 정상 결과가 없다.
- EP01에서 반복된 인용 변형이 전체 실패를 유발했다. E16의 `합리적이야.`를 `합리적이다.`로 바꾸고 E19의 `메인 데이터`에서 공백을 삭제했다. 의미가 비슷하다는 이유로 통과시키지 않은 것은 올바르다.
- 사용자 IndexedDB 가설은 거부 후보에서도 question에만 담겼다. 사용자 가설 객체를 독립적으로 회수하는 문제는 해결됐다고 볼 수 없다.
- EP01 마지막 후보는 사용자 E17의 생각 변화 대신 AI 권고 간 차이를 contradiction으로 표현했다. 사용자와 AI의 사고 변화는 구분해야 한다. 관계 그래프가 없다는 이유로 실패를 매기지 않았다.
- EP01 마지막 후보에 E18의 과거 미결정 상태가 open_question으로 남았다. E19의 이후 확정과 함께 해석할 시간 범위가 필요하다. 이는 거부 후보에 대한 진단이며 새 정상 결과의 오분류 점수로 보고하지 않았다.
- EP02는 미해결 질문을 assistant/open_question으로만 만들고 직접 사용자 보류 발언을 decision으로 표현했다. 의미는 남았지만 user/open_question 검색·집계의 커버리지는 빈다.
- EP02에서 저장소 결정의 AI 재요약을 독립 evidence로 다시 추출했다. 같은 문장이 존재하더라도 해당 Episode 목적에서 중요한 객체인지 따로 평가해야 한다.

## 6. 다음 개발 우선순위 — 이번에는 구현하지 않음

1. **최우선: 인용 생성·교정 안정성.** 원문 범위를 선택해 참조하게 하거나 실패한 Evidence만 좁혀 교정하는 방안을 검토한다. 원문 검증을 완화하는 것이 목표는 아니다. 현재 전체 재생성은 같은 인용 오류를 반복하고 새 오류도 추가했다.
2. **사용자 명시 가설·생각 변화의 역할 보존.** 복합 질문 안의 가설과 판단 변화를 user 근거의 객체로 회수하는 기준을 정의한다. AI 재서술로 대체되지 않게 해야 한다.
3. **미해결 상태와 판단 보류의 유형·시간 범위 정의.** 검색 행동, 역사적 미결정, 현재 미해결, 보류하기로 한 결정이 어떻게 함께 표현돼야 하는지 정한다. 이번에는 관계 그래프 부재를 감점하지 않았다.
4. **목적별 중요도·중복 검토.** 같은 자료의 반복과 AI 확인 문구를 핵심 사용자 사고와 구분하되, 출처·발화 주체·판단 시점 차이를 무조건 합치지 않는다.

## 7. 재현과 해석 한계

```sh
node scripts/evaluate-e2e-test-01.mjs output/e2e-test-01-new-run
# 전체 실행이 EP01에서 실패한 경우에만 EP02 독립 진단을 추가
node scripts/evaluate-e2e-test-01-ep02.mjs output/e2e-test-01-new-run
```

출력 디렉터리는 새 경로여야 하며 기존 Run·모델 응답·체크포인트 파일을 덮어쓰지 않는다. API Key는 .env.local에서 읽고 출력/보고서에 포함하지 않는다. 호출 비용은 발생한다. 이번 실행의 요청·응답과 모델 사용량은 원본 JSON에 보존했다.

한 실제 세션과 한 새 전체 실행, 실패 후 한 독립 EP02 진단에 대한 탐색 평가다. 같은 모델도 실행마다 달라지므로 분할 정책만의 인과 효과나 일반적인 성능 향상을 주장하지 않는다. 기존 Run 당시의 전체 요청 payload가 보존되지 않아 과거 입력 직렬화까지 동일했다고 검증할 수는 없다. 현재 코드는 시작·종료 해시로 고정했으며 Extraction 정책은 이번 작업에서 바꾸지 않았다. 수동 의미 평가는 동일 어시스턴트가 결과를 본 뒤 수행한 비맹검 평가이므로 독립 사람 평가와 구분해야 한다.

## 결과물

- [전체 실행·독립 진단·기존 결과 통합 JSON](full-evaluation-results.json)
- [원래 전체 실행 결과 JSON — failed](new-analysis.json)
- [EP02 독립 진단 JSON — complete](ep02-diagnostic-analysis.json)
- [Ground Truth·지표·주석 JSON](semantic-evaluation.json)
- [오류 유형별 평가표](error-evaluation.md) / [CSV](error-evaluation.csv)
- [주요 객체와 모든 Evidence 연결](key-objects-and-evidence.md)
- [원본 필드 전문](source-evidence.md)
- [실행 전 고정한 프로토콜](protocol.json)

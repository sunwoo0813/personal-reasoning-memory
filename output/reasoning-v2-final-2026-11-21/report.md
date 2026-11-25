# Reasoning Extraction v2 — 구현 및 반복 품질 검증

의미 판정은 개발을 수행한 **Codex 에이전트의 추가 원문 대조**다. 사람의 검토·독립 블라인드 평가·객관적 의미 검증 완료가 아니며 이 판정도 틀릴 수 있다. 아래의 “개발자 평가”는 이 에이전트 대조를 뜻한다.

작성일: 2026-11-21 (Asia/Seoul)

**구현·회귀 테스트·로컬 반복 평가를 완료했다. 그러나 전체 의미 품질 개선 목표는 아직 충족했다고 볼 수 없다.** 최종 3회는 모두 자동 완료했고 사용자 IndexedDB 가설과 회원가입 보류를 회수했지만, 개발자 대조에서 164개 중 81개가 유형 또는 선택 근거 적합성 문제를 보였다. 운영 워커의 기본값은 기존 reasoning-v1로 유지하고 v2는 명시적 선택으로 제공한다. 운영 워커 실행·배포·DB 저장은 하지 않았다.

## 1. 기존 Reasoning Extraction 오류의 원인

- lib/analysis.js의 기존 추출 지시는 7가지 유형을 일반적으로 나열했고, 긴 본문·AI 응답·사용자 발언을 같은 단계에서 처리했다. 사용자 IndexedDB 단독 가설은 Question 안에 담기거나 AI Hypothesis만 남았다.
- 검색 query의 speaker가 user라는 구조 규칙은 검색 행동이 해결할 질문이라는 의미를 보장하지 않는다. 기존 35개 결과는 검색어를 Question 2개/Open Question 2개로 분류했다.
- E22의 보류 발언도 사용자 question 필드이므로 기존 Decision의 화자/인용 검증은 통과할 수 있었다. 직전 Grounding v2 완료 Run에서는 이를 Decision 1개/3개로 잘못 분류했다.
- 기존 review_evidence_grounding은 유형 재분류를 금지했다. exact substring 검증과 의미적 유형 검증은 다른 문제이며, 정확한 원문을 가져와도 문서 소개·표 조각으로 더 넓은 주장을 정당화하는 오류가 있었다.
- 기존 DB에는 부분 완료 상태가 없고 finish RPC는 전체 결과를 원자적으로 저장한다. 미해결 검증 실패가 남으면 전체 Run 실패라는 구조는 이번에도 유지했다.

## 2. 수정한 분류 정책과 추출 방식

lib/reasoning-policy.js에 7가지 유형의 의미와 사용자 사고 우선순위를 정의했다. 사용자 질문은 직접 제기한 문제, 가설은 잠정 선호/설명/방안, Insight는 명시적으로 표현한 이해/변화, Contradiction은 실제 기존 가설에 대한 반론으로 구분한다. Decision은 사용자 채택/기각에 한정하고 보류는 Open Question으로 정의했다. 검색어·AI 일방 질문·이미 해결된 문제는 미해결 질문으로 취급하지 않도록 지시했다.

사용자 question 근거만 먼저 추출 → 모든 사용자 발언의 사고 유형 누락과 해결 상태를 재검토하여 초안 수정 → 필요한 assistant/source 근거 보충 순서다. 보충 단계는 사용자 객체·Decision·Question·Open Question을 만들 수 없고, 이후 국소 교정도 사용자 슬롯을 AI로 바꾸어 오류를 숨길 수 없다. 초안과 재검토 응답·객체 수를 감사에 보존한다. 이 누락 재검토 자체는 모델 기반이며 완전성 검증 완료로 표시하지 않는다.

## 3. 의미적 근거 적합성 검증 변경

기존 근거 ID/UTF-16 구간 복원, 부분 문자열 일치, 엄격한 사용자 Decision 검증은 유지했다. 유형·발화 주체·잠정/채택 상태·부분 인용/부정·이후 해결 여부를 근거 검토에 추가하고, Episode 사용자 발언을 해석용 문맥으로 제공했다. 문맥은 선택 근거를 대신하지 않는다. 실패 슬롯만 최대 2회 교정하고 통과 객체는 고정한다. 형식 오류도 제한된 재시도 후 거부한다.

quote_matched는 정확한 원문 일치만 뜻한다. grounding_review=model_supported, semantic_verification=not_verified를 유지했다. 아래 개발자 평가에서 지적한 오답은 자동 검토가 놓친 false positive다. 자동 완료 객체를 사람 검증된 정상 정답으로 제시하지 않는다. 검증기가 실제로 거부한 후보는 정상 저장하지 않는다.

DB 스키마/상태 변경 없이 all-or-nothing을 유지했다. 따라서 회복 불가능한 적합성 오류가 전체 실패로 이어지는 제한은 해결되지 않았다. 부분 성공을 complete로 바꾸어 완료율을 높이지 않았다.

## 4. 변경 파일과 주요 로직

- lib/reasoning-policy.js: 공통 분류 기준, 사용자 유형/해결 상태 초안 재검토 지시, 단계별 화자/유형 스키마.
- lib/evidence-grounding.js: 사용자 우선 추출·재검토·보충, 유형 포함 의미 검토, 교정 중 화자 소유권 보호, 감사/사용량, 정책별 체크포인트 검증.
- lib/analysis.js: reasoningVersion 선택과 실제 사용한 정책 버전/mixed 반환. 기존 체크포인트를 v2로 재표시하지 않음.
- scripts/analyze.mjs: PRM_REASONING_POLICY로 v2 명시적 선택, 기본 reasoning-v1 유지, 잘못된 설정은 DB 작업 청구 전에 실패.
- tests/reasoning-policy.test.mjs 및 기존 grounding/segmentation/DB 테스트: 신·구 정책 분리 검증, JSONB 재개와 기존 SQL 트랜잭션 호환 확인.
- evals/reasoning-v2/: 실행 전 고정한 프로토콜·12개 의미 목표·4개 개발 독립 사례·최종 신규 2개 사례.
- scripts/evaluate-reasoning-v2.mjs, evaluate-reasoning-independent.mjs, summarize-reasoning-v2.mjs: DB 읽기 전용 실행·원문 내보내기·명시적인 개발자 평가에 근거한 집계.
- docs/reasoning-extraction-v2.md, README.md: 사용·버전·운영 적용 제한.

이 작업 전에 있던 hydration/DB 오류 처리·Segmentation/Grounding 변경은 별도 기존 변경으로 유지했다. db/analysis.sql과 purpose-v2 구현은 이번에 수정하지 않았다. 외부 pipeline_version=extraction-v1 SQL 계약과 기존 데이터/체크포인트를 유지한다.

## 5. 기존 및 신규 테스트

기존 84개를 유지하고 11개를 추가해 **95/95 통과**했다. npm run build와 git diff --check도 통과했다. 사용자 전용 근거, 보충 스키마의 화자/유형 제한, 사용자 가설과 AI 재서술 분리, 보류 오분류의 국소 교정, 성공 형제 고정, 교정 시 화자 변경 금지, 검색/metadata-only 처리, 부적합 원문 해석 거부, 정책/해시 체크포인트 재개, 누락 재검토와 제한된 형식 재시도를 포함한다. 기존 정확 인용/Unicode/허위 근거/실패 결과 미저장/DB 무결성 테스트도 유지했다.

모의 응답 테스트는 제어 흐름과 검증 계약을 확인하며 실제 의미 정확성을 증명하지 않는다. 실제 모델에서 확인한 오류는 아래와 같이 별도로 보고한다.

## 6. 기존 E2E 세션 재분석

원본 Run c4bbd6f5-77d4-4a55-a5b3-7d3f1c410061의 22개 스냅샷, gpt-5-mini, purpose-v2 E01–E19 / E20–E22를 고정했다. 각 반복은 새 로컬 실행이며 추출 체크포인트를 재사용하지 않았다. 원본 project/session/events/content/run/steps/episodes 관계의 전후 해시와 실행 중 코드 해시가 일치했다. 기존 DB 행·세션·Run·체크포인트에 쓰지 않았다.

| 반복 | EP01 자동 통과 객체 | EP02 자동 통과 객체 | 전체 자동 완료 | 국소 교정 |
|---:|---:|---:|---|---:|
| 1 | 34 | 19 | complete | 0 |
| 2 | 11 | 52 | complete | 0 |
| 3 | 39 | 9 | complete | 0 |

“자동 통과”는 구조/인용/모델 검토 통과 수이며 의미적 정답 수가 아니다. 최종 자동 검토는 모든 후보를 승인했고, 개발자 대조에서 아래 오류가 드러났다. 이 오답도 원시 결과에 보존하고 developer-assessment.json에서 부적합으로 분리한다.

| Ground Truth | 최종 회수 | 판정 |
|---|---|---|
| 초기 Offline-first 선호의 독립 Hypothesis | 0/3 | Question 안에만 포함되어 유형 회수 실패 |
| 사용자 IndexedDB 단독 Hypothesis | 3/3 | E16 user/question 직접 근거 |
| 사용자 위험 인식·명시적 판단 변화의 독립 유형 | 2/3 | 반복 2는 잘못된 Open Question 안에만 남음 |
| Cloud-first/Supabase 미결정 검토의 적절한 유형 | 2/3 | 반복 2에서 해결 후에도 Open Question으로 남음 |
| Supabase 메인 + IndexedDB 보조 채택 | 3/3 | E19 직접 사용자 Decision |
| IndexedDB 단독 기각 | 3/3 | 같은 E19 Decision에 함께 표현 가능 |
| 회원가입 질문 + UX/복잡도 기준 | 3/3 | E20 직접 근거 |
| 회원가입 미결정 + 테스트 후 재검토 조건 | 3/3 | E22 user/Open Question |

12개 목표는 같은 개수의 객체를 강제하지 않는다. 하나의 결정이 채택/기각 두 사실을 담을 수 있고, 하나의 Open Question이 보류/재검토 조건을 담을 수 있다. 질문 안에만 묻힌 가설/변화는 부분 표현으로 기록하고 해당 독립 유형 회수에는 넣지 않았다.

최종 신규 garden/baking 2개는 자동 2/2 완료, 원문 14/14 일치였다. 개발자 의미 평가는 13/14 지지, garden O4의 “설치 여부” 추가는 부적합이다. 전철/수업/행사/도구의 앞선 4개 사례는 개발 결과를 본 사례이므로 최종 holdout과 구분한다. 자세한 기록은 ../reasoning-v2-holdout-2026-11-21/report.md에 있다.

## 7. 개선 전후 품질 비교

실행 전 고정한 동일 기준으로 개발자가 text/type/speaker와 선택 원문을 대조했다. 블라인드 외부 평가가 아니고, 선택한 인용이 모든 주요 주장을 지지하는지 엄격하게 판정했다. 문서 전체에 사실이 존재해도 선택 인용이 부족하면 부적합이다. 유형/귀속도 의미 적합성에 포함한다. 오류 이유와 객체 ID는 developer-assessment.json에 전부 있다.

| 범위 | 핵심 질문 회수 | 사용자 가설 회수 | Decision 정밀도 | Decision 사실 회수 | Open Question 정밀도 | 미해결 사실 회수 | 인용 일치 | 개발자 의미 적합 | 중복/불필요 |
|---|---|---|---|---|---|---|---|---|---|
| 기존 extraction-v1 | 2/2 | 0/2 | 1/1 | 2/2 | 1/4 | 2/2 | 36/36 | 26/35 | 7 |
| 이전 Grounding v2 | 4/6 | 0/6 | 2/6 | 4/6 | 0/5 | 0/6 | 101/101 | 28/49 | 7 |
| Reasoning v2 최종 | 6/6 | 3/6 | 3/3 | 6/6 | 3/6 | 6/6 | 339/339 | 83/164 | 40 |

이전 Grounding v2의 실패 1회는 운영 회수율 분모에서 빼지 않았다. 완료 결과만 보면 이전 사용자 결정 회수는 4/4, 핵심 질문은 4/4이며, 실패까지 포함하면 각각 4/6이다. 실패 Run에는 수락 객체가 없으므로 정밀도 분모에는 객체를 더하지 않는다. 이전 완료 결과는 24+25=49개, 새 결과는 53+63+48=164개다.

새 가설 회수 3/6은 IndexedDB 단독 3/3과 초기 Offline-first 독립 가설 0/3의 합이다. Open Question의 두 기대 사실(보류/재검토 조건)은 한 객체에 함께 표현될 수 있으므로 사실 회수 분모와 예측 객체 정밀도 분모가 다르다.

필드/화자 구조 일치는 새 결과 164/164지만, text가 주장한 주체까지 대조하면 162/164였다. 반복 2의 AI Evidence 두 개가 사용자 발언 기록이라고 주장하면서 AI 재서술/다른 질문을 인용했다. 원문 일치 339/339와 이 의미 오류는 양립한다.

**회수와 Decision/보류 구분에는 개선이 있었으나 전체 의미 적합성·중복 억제는 개선됐다고 할 수 없다.** 새 결과의 개발자 적합성은 83/164(50.6%)이며 이전 Grounding v2는 28/49(57.1%)다. 이 비율은 서로 다른 객체 집합과 실행 변동의 영향을 받는다. 전체 객체 수 증가나 자동 완료율 상승을 품질 향상으로 해석하지 않는다. 특히 새 자동 검토가 오류를 놓친 탓에 교정이 발생하지 않았을 가능성이 있어, 3/3 완료를 더 엄격하고 안정적인 의미 검증의 증거로 삼을 수 없다.

## 8. 완료율·토큰·지연

| 범위/반복 | 자동 완료 | 입력 토큰 | 출력 토큰 | 총 토큰 | 시간 | 호출 |
|---|---|---:|---:|---:|---:|---:|
| 이전 Grounding v2 1 | complete | 135,967 | 7,508 | 143,475 | 88.9초 | 6 |
| 이전 Grounding v2 2 | failed | 170,217 | 7,601 | 177,818 | 89.9초 | 6 |
| 이전 Grounding v2 3 | complete | 199,452 | 10,299 | 209,751 | 123.2초 | 10 |
| Reasoning v2 1 | complete | 93,491 | 12,515 | 106,006 | 142.3초 | 8 |
| Reasoning v2 2 | complete | 92,438 | 13,027 | 105,465 | 151.1초 | 8 |
| Reasoning v2 3 | complete | 98,137 | 12,414 | 110,551 | 149.8초 | 8 |

새 3회 합계 입력 284,066 / 출력 37,956 / 총 322,022 토큰, 평균 147.7초다. 초기 개발 실험 3회(3/3 자동 완료)와 독립 사례의 비용은 이 최종 분모에 섞지 않았다. 초기 개발 실험에는 EP02 76객체 과분해가 있었고 원시 이력을 별도 보존했다. 최종에서도 EP02 52객체와 27개 반복/불필요 객체가 한 실행에 발생했다.

기존 원본 extraction-v1 Run의 저장된 체크포인트 사용량은 추출만 45,790토큰, 분할 포함 73,610토큰이고 처리 시각 차이는 127.0초다. 4개 Episode와 분할 비용을 포함하므로 고정 2개 Episode 재추출과 직접적인 속도/비용 효과로 비교하지 않는다. 토큰은 청구 비용 환산이 아니며 캐시 원시 사용량은 각 호출에 남았다.

## 9. 남은 오류와 다음 개발 과제

1. **의미 검토의 false positive**: 소개 문단·제목·표 조각을 고른 뒤 async/transaction/Auth/API 이름 등 선택 인용에 없는 세부 내용을 덧붙여도 모델 검토가 승인한다. 가장 먼저 주장 단위 검토와 작은 검토 배치/부적합 근거 탐지의 실제 효과를 별도 프로토콜로 검증해야 한다.
2. **해결 상태와 초기 선호 누락**: 초기 Offline-first를 독립 Hypothesis로 보존하지 못하고, E17/E18의 이미 해결된 검토 또는 “정리해줘”를 Open Question으로 남긴다. 초안 재검토만으로 보장되지 않는다.
3. **Contradiction 과분류**: 선택지 차이·보안 유의사항·현재와 미래 비용을 실제 충돌하는 이전 가설 없이 Contradiction으로 만든다.
4. **AI/source 과잉 및 중복**: 보충 단계의 소유권 제한은 사용자 대체를 막지만 AI 재서술을 다른 유형으로 반복하는 문제는 남는다. 동일 발언의 독립 정보 기여를 측정하는 억제/선별 검증이 필요하다.
5. **부분 실패 정책**: DB 부분 상태를 새로 만들지 않았으므로 거부된 슬롯이 교정되지 않으면 전체 실패다. 성공 후보는 진단용으로만 남긴다. 이번 자동 완료가 이 구조를 해결했다는 뜻은 아니다.
6. **평가 한계**: 한 세션·작은 합성 사례·동일 모델의 작은 반복 표본·개발자 비블라인드 판정이다. 일반 성능이나 Segmentation/추출/검토 각각의 단독 인과 효과는 확정할 수 없다. Relationship Analysis는 구현하거나 점수화하지 않았다.

이 결과 때문에 운영 워커는 reasoning-v1을 기본값으로 유지했다. 평가 종료 뒤 변경은 워커의 정책 선택/잘못된 설정 조기 거부뿐이고, 평가된 reasoning-v2 추출·검토 코드는 변경하지 않았다. post-evaluation-note.json에 해시를 남겼다. v2는 새 로컬 평가 또는 명시적으로 선택한 새 Run에 사용할 수 있으며, 기존 Run을 재처리하거나 승격하지 않았다.

## 재현 및 결과물

```sh
node scripts/evaluate-reasoning-v2.mjs output/reasoning-v2-new-check 3
node scripts/evaluate-reasoning-independent.mjs output/reasoning-v2-new-holdout evals/reasoning-v2/holdout-cases.json
node scripts/summarize-reasoning-v2.mjs output/reasoning-v2-new-check
```

새 출력 경로를 사용한다. summarize 스크립트는 developer-assessment.json 없이 의미 평가를 자동으로 정답 처리하지 않는다. 새 실행에는 새 개발자 대조가 필요하다.

- full-analysis-results.json / run-*/analysis-result.json: 전체 자동 분석 결과와 실행 상태·사용량
- quality-metrics.json / developer-assessment.json: 산식·객체별 의미 판정·정답 연결
- error-evaluation.md / error-evaluation.csv: 오류 유형과 대상 객체
- key-objects-and-evidence.md: 핵심 사고 요소와 원문 Evidence
- all-objects-and-evidence.md / object-inventory.json: 기존·신규 모든 객체와 모든 선택 인용
- protocol.json / source-snapshot.json / segmentation-checkpoint.json / call-*.json / audit-trace.jsonl: 고정 조건·원본·전체 호출/감사
- ../reasoning-v2-2026-11-21/: 초기 개발 3회, ../reasoning-v2-independent-2026-11-21/: 4개 개발 사례
- ../reasoning-v2-holdout-2026-11-21/: 최종 독립 2개 사례와 별도 평가

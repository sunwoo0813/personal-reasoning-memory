# Reasoning Extraction v2

사용자가 실제로 표현한 질문·가설·판단 변화·채택/기각·미해결 문제를 중심으로 추출한다. 분류 정책은 `reasoning-v2`, 원문 근거 방식은 `evidence-v2`, 분할은 `purpose-v2`다. 기존 SQL 외부 계약 `pipeline_version: extraction-v1`은 유지한다.

## 원인과 분류

기존 추출은 긴 기술 본문과 사용자 발언을 동시에 다루고, 모든 유형을 일반적인 나열로 지시했다. 사용자 가설이 질문 안에 포함되거나 AI가 재서술한 가설만 남았고, 회원가입 보류가 Decision으로 추출됐다. 기존 근거 검토는 유형 재분류를 금지하여 문자열·관련성 검토만으로 분류 오류를 고치지 못했다.

`lib/reasoning-policy.js`는 일곱 유형의 의미, 시간적 상태, 사용자·AI·자료의 귀속을 공통으로 정의한다. 원문에 직접 표현된 가설/변화만 추출하며, 추천이나 자료 접근을 사용자의 채택으로 간주하지 않는다. 보류는 Open Question이고 채택/기각 결정과 구분한다. 초기 질문은 이후 해결되어도 질문으로 기록할 수 있으나 계속 미해결로 표시해서는 안 된다. 검색 문자열만으로 질문이나 Open Question을 만들지 않는다.

## 추출과 검토

사용자 question 원문만 별도로 추출한다. `review_user_reasoning`에서 각 발언의 독립적인 질문·가설·변화·채택/기각·미해결 상태 누락을 점검하여 초안을 재작성한 다음, 그 사고 활동에 필요한 assistant/source 근거를 보충한다. 두 단계의 스키마와 런타임 검사는 발화 주체 범위를 제한한다. 보충 단계는 사용자 객체를 덮어쓰지 못하며 사용자 결정·질문·미해결 질문을 생성할 수 없다. 후속 교정도 사용자 슬롯을 AI 슬롯으로 바꾸어 오류를 숨길 수 없다. 초안과 재검토 응답, 각각의 사용자 객체 수를 감사에 남기며 이 재검토를 완전성 검증 완료로 표시하지 않는다. 형식 오류는 한 번만 추가 요청한다. 원문·유형 검증을 통과한 객체의 국소 교정과, 승인 전 초안 재검토를 구분한다.

기존 코드가 만든 원문 구간 ID를 선택하고 UTF-16 위치에서 인용을 복원하는 구조는 유지한다. 모든 객체의 원문 부분 문자열·구간·화자·엄격한 사용자 Decision 검증을 거친 뒤 모델이 유형, 관련성, 귀속, 부정, 채택 여부와 Episode 내 해결 상태를 검토한다. 검토에는 선택 구간/인접 구간 및 Episode의 사용자 발언을 제공한다. 해석용 문맥은 선택 근거를 대신하지 못한다.

실패 객체만 최대 2회 교정한다. 통과한 형제 객체와 검토 결과는 고정한다. `quote_matched`는 원문 일치, `grounding_review.status: model_supported`는 오류 가능한 모델 판단이며 `semantic_verification: not_verified`를 유지한다.

## 운영 적용 상태

최종 3회 자동 완료만으로 정책을 운영 기본값으로 승격하지 않았다. 개발자 의미 평가에서 과분류·부적합 근거·중복이 남아 `scripts/analyze.mjs`는 기본 `reasoning-v1`을 명시한다. v2는 라이브러리의 reasoningVersion 또는 워커의 PRM_REASONING_POLICY=reasoning-v2로 선택할 수 있다. 이번에는 운영 워커를 실행하거나 기존 Run을 재처리하지 않았다. 평가 후 변경은 이 워커의 기본 선택/설정 검증뿐이며, 평가된 v2 추출·검토 구현은 변경하지 않았다.

## 저장·재개

기존 상태는 complete/failed 등이며 부분 완료 상태가 없다. 이번에는 DB 스키마를 바꾸지 않고 전부 통과해야만 Episode/Run 완료로 처리한다. 실패 후보와 통과 후보는 감사 JSON에서 구분하되 실패 Run의 정상 저장 객체로 포함하지 않는다. 따라서 근거 교정을 모두 소진하면 여전히 전체 완료가 실패할 수 있다.

추출 체크포인트에 reasoning_version과 객체 검토 policy를 기록하고 검토된 객체 해시와 결합한다. 이전 체크포인트는 이전 정책으로 재검증·재사용하며 덮어쓰거나 v2로 재표시하지 않는다. 재개 중 신·구 정책이 섞이면 결과는 mixed다. 완료 전 grounding_audit는 정상 완료 체크포인트가 아니며 새 Run이 필요하다.

## 평가와 재현

`evals/reasoning-v2/`에 실행 전 고정한 평가 기준, 22개 이벤트 Ground Truth, 메모 앱과 다른 분야의 독립 합성 사례가 있다. 실제 모델 평가는 모의 모델 제어 흐름 테스트와 구분한다. 개발자 의미 평가는 블라인드 외부 평가가 아니다.

```sh
node scripts/evaluate-reasoning-v2.mjs output/reasoning-v2-new-check 3
node scripts/evaluate-reasoning-independent.mjs output/reasoning-v2-new-independent
node scripts/evaluate-reasoning-independent.mjs output/reasoning-v2-new-holdout evals/reasoning-v2/holdout-cases.json
node scripts/summarize-reasoning-v2.mjs output/reasoning-v2-new-check
```

첫 스크립트는 기존 DB를 읽기만 하고 원본/Run/체크포인트의 전후 상태를 비교한다. 모든 추출·교정은 새 로컬 디렉터리에 저장하며 분할만 기존 purpose-v2 결과를 고정한다. 실행 결과의 수락 객체는 새로운 분석 Run을 DB에 만든 것과 다르다. 두 번째 스크립트는 DB를 사용하지 않는다. 세 번째 스크립트는 모든 객체와 원문을 내보내고 명시적인 developer-assessment.json에 있는 의미 평가만 점수화하며, 미평가 객체를 자동으로 정답 처리하지 않는다.

단일 세션 반복으로 일반 성능이나 개선 원인의 단독 효과를 확정하지 않는다. 새 정책을 시험할 때는 새 디렉터리를 사용하고 실패 이력도 보존한다.

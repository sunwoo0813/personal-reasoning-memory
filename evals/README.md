# 분할·추출 반복 평가

`cases.mjs`는 기존 수집·분석 코드와 분리된 합성 시나리오 8종과 핵심 정답 앵커다. 기존 모델·프롬프트를 고정하고 각 입력을 두 번 실행한다.

1. `.env.local`의 기존 Supabase·OpenAI 연결과 `db/analysis.sql` 설정이 필요하다.
2. `npm run analyze`로 일반 분석 워커를 실행한다.
3. `node scripts/evaluate-analysis.mjs`를 실행한다. 검증용 프로젝트에 세션과 Run을 추가하고 실제 모델을 호출한다. 출력 폴더는 실행 시각별로 생성된다. 원하는 새 폴더는 첫 번째 인자로 전달한다.
4. 완료 후 `node scripts/summarize-evaluation.mjs <출력 폴더>`로 결과를 집계한다.
5. 객체의 해석 품질은 원문과 별도로 대조한다. 사후 판정은 사전 고정 앵커 점수와 섞지 않는다. `review-notes.md`가 있으면 보고서에 함께 붙인다.

- 핵심 결정은 유형·주체·이벤트·필드·인용 앵커로 일대일 대응한다. 전체 객체 의미 정확도와 다르다.
- 명시적인 주제 전환 사례만 경계 위치의 정확한 정답을 둔다. 다른 입력의 분할 개수는 기술 통계로만 확인한다.
- 실패한 Run도 완료율과 전체 핵심 결정 재현율 분모에 포함한다.
- 생성된 결과와 프로토콜은 `docs/verification/evaluation-2026-11-05/`에서 볼 수 있다.

평가 설계 참고: [OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

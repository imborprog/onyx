# 유형공장 (typemaker)

AI 브랜드 심리테스트 메이커 MVP. 마케터·소상공인·학원이 주제만 넣으면 AI가 문항·결과·공유 이미지까지 만들고,
결과 공유 → 리드 수집 → 쿠폰 발급까지 연결한다. 운영(고객응대·판매·홍보)은 Claude가 `ops` 스키마와
[`ops/PLAYBOOK.md`](ops/PLAYBOOK.md)를 따라 수행하도록 설계했다.

## 구성

| 영역 | 위치 |
|---|---|
| 랜딩·요금·갤러리·문의·약관 | `src/app/page.tsx`, `pricing`, `gallery`, `contact`, `legal` |
| 테스트 만들기 (AI / 템플릿 / 운영팀 제작 요청) | `src/app/create`, `src/app/api/tests/route.ts`, `src/lib/ai.ts`, `src/lib/templates.ts` |
| 관리 화면 (편집·리드·성과·공유) | `src/app/w/[secret]`, `src/components/Editor.tsx` |
| 참여 화면·결과 공유·OG 이미지 | `src/app/t/[slug]`, `src/components/Player.tsx`, `src/app/api/og` |
| 리드 수집 (동의·14세 확인·보관기간) | `src/components/LeadForm.tsx`, `src/app/api/leads` |
| 결제 (토스페이먼츠 결제창 v2 + 서버 승인) | `src/components/Checkout.tsx`, `src/app/api/orders`, `src/app/api/payments/confirm` |
| 고객지원 (AI/FAQ 즉시 답변 + 티켓) | `src/app/support`, `src/app/api/support` |
| 메일 (Resend, outbox 패턴) | `src/lib/email.ts`, `src/app/api/cron/outbox` |
| DB 스키마·운영 함수 | `db/migrations/001_init.sql`, `db/migrations/002_ops.sql` |
| 운영 매뉴얼·하우스 테스트 | `ops/PLAYBOOK.md`, `ops/house-tests/*.json` |

계정은 없다. 테스트를 만들면 비밀 관리 링크(`/w/<secret>`)가 생기고 브라우저에 저장된다.

## 로컬 실행

```bash
npm install
npm run dev            # DATABASE_URL이 없으면 .data/pglite에 내장 Postgres(PGlite) 사용
```

환경변수는 `.env.example` 참고. 키가 없어도 동작한다:

| 키 없음 | 동작 |
|---|---|
| `ANTHROPIC_API_KEY` | 템플릿 초안 즉시 생성 + "운영팀 제작 요청"(Claude가 큐에서 처리) |
| `TOSS_*` | 카드 결제 대신 계좌이체·세금계산서 문의 접수 |
| `RESEND_API_KEY` | 메일은 outbox에 쌓이고, 고객은 문의 페이지에서 답변 확인 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 카카오 버튼 대신 기본 공유·링크 복사 |

## 검증

```bash
npm run typecheck && npm test           # 타입 + 단위 테스트
npm run build
rm -rf .data/e2e && PGLITE_DIR=.data/e2e node scripts/seed-house-tests.mjs
PGLITE_DIR=.data/e2e npx next start -p 3100 &   # 별도 터미널
BASE_URL=http://localhost:3100 node scripts/e2e-smoke.mjs
# 서버 종료 후
PGLITE_DIR=.data/e2e node scripts/ops-check.mjs
```

## 배포 (Supabase + Vercel)

1. Supabase 프로젝트에 `db/migrations/*.sql`을 순서대로 적용하고, 앱 전용 역할을 만든다 (`db/supabase-app-role.sql` 참고, 비밀번호는 직접 생성).
2. Vercel 프로젝트 루트 디렉터리를 `typemaker`로 두고 환경변수를 넣는다. `DATABASE_URL`은 Supavisor transaction pooler(`...pooler.supabase.com:6543`) 주소에 앱 역할(`app_user.<project-ref>`)을 쓴다.
3. `kv` 테이블에 `app_url`, `brand_name`, (계좌이체 판매 시) `payment_instructions`를 넣는다.
4. 하우스 테스트 발행: `NEXT_PUBLIC_APP_URL=https://… node scripts/seed-house-tests.mjs --sql` 출력 SQL 실행.

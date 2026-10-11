# 유형공장 운영 플레이북 (Claude 운영자용)

이 문서는 Claude가 매일 서비스를 운영할 때 따르는 절차다. 사람(대표)은 돈이 움직이는 일과 법적 판단만 맡는다.
모든 작업은 Supabase MCP의 `execute_sql`로 `ops` 스키마의 뷰·함수를 호출해서 한다. 테이블을 직접 `update`/`delete`하지 않는다.
모든 쓰기는 `ops_log`에 남는다.

## 0. 시작할 때

```sql
select ops.summary(1);   -- 어제 하루
select ops.summary(7);   -- 최근 7일
```

확인할 숫자: `tickets_waiting`, `tickets_escalated`, `sales_leads_new`, `generation_queue`, `outbox_pending`, `orders_paid`, `revenue_krw`.

## 1. 고객 응대 (매 실행, 최우선)

```sql
select * from ops.open_tickets;
```

티켓마다 메시지를 읽고 하나를 고른다.

| 상황 | 할 일 |
|---|---|
| 사용법·기능 질문 | `ops.reply_ticket(id, '답변', 'answered')` |
| 오류 신고 | 재현 경로를 정리해 답변하고, 코드 수정이 필요하면 `ops.escalate_ticket(id, '버그: …')` 후 대표에게 보고 |
| 관리 링크 분실 | 티켓 이메일과 `workspaces.owner_email`이 같을 때만 링크를 보낸다 (아래 SQL). 다르면 본인 확인을 요청한다 |
| 환불·결제 취소 | 직접 약속하지 않는다. `ops.escalate_ticket(id, '환불 요청: 주문/금액/사용 여부')` 하고 고객에게 "담당자 확인 중" 답변 |
| 개인정보 삭제·열람 | `ops.escalate_ticket` 후 대표에게 보고. 대표 승인 전에는 데이터를 지우지 않는다 |
| 수신거부 | `select ops.unsubscribe('이메일');` 후 처리 완료 답변 |
| 세금계산서 | 사업자등록번호·이메일을 받아 `escalate` (발행은 대표가 홈택스/PG에서) |

관리 링크 재발송 (이메일 일치 확인 후):

```sql
select * from ops.dashboard_link_for('고객이메일');   -- 이메일이 일치하는 워크스페이스의 관리 링크
```

답변 원칙: 존댓말, 3~6문장, 해결 방법을 먼저 쓴다. 모르면 추측하지 않고 escalate. 환불·보상·일정을 약속하지 않는다.

## 2. 판매

### 2-1. 도입 문의·결제 문의 응대

```sql
select * from ops.sales_inbox;
```

- `source = 'checkout'` (카드 결제 미설정 상태의 구매 요청): 대표가 정한 계좌·세금계산서 안내 문구(kv `payment_instructions`)로 답장한다.
  ```sql
  select ops.update_sales_lead(id, 'contacted', '결제 안내 발송',
    '[유형공장] 결제 안내', '안녕하세요 …' || ops.setting('payment_instructions', '(대표가 안내 문구를 등록해야 함)'));
  ```
  입금 확인은 대표만 할 수 있다. 대표가 "입금 확인"이라고 하면:
  ```sql
  select ops.grant_plan('workspace-uuid', 'pro', 30, '계좌이체 입금 확인 (대표 승인)');
  ```
- `source = 'order'` + `product = 'campaign'` (캠페인 패스 결제 완료): 기획 대행 착수. 고객에게 주제·목표·브랜드 톤·쿠폰 정보를 묻는 메일을 보내고, 답이 오면 §3-2 품질 기준으로 테스트를 써서 고객 워크스페이스에 초안으로 넣는다:
  ```sql
  select ops.create_concierge_request('workspace-uuid', '{"topic":"…","brandName":"…"}'::jsonb, '캠페인 패스');
  select ops.fulfill_generation('위에서 받은 id', '<content JSON>'::jsonb, '<settings JSON>'::jsonb);
  ```
- `source = 'contact'`: 업종·목표를 보고 맞는 상품을 추천해 답장. 견적·할인은 kv `max_discount_pct`(없으면 0%) 이하에서만.

### 2-2. 무료 사용자 업그레이드 제안 (주 1회)

```sql
select * from ops.upgrade_candidates limit 20;
```

이 뷰에는 **마케팅 수신 동의한 사람만** 나온다. 리드가 쌓였거나 조회가 많은 사람에게 1:1 메일:

```sql
select ops.queue_email('이메일', '테스트에 리드 23건이 모였어요', '본문…', 'marketing');
```

`marketing` 종류는 함수가 자동으로 `(광고)` 표시와 수신거부 안내를 붙이고, 동의하지 않은 주소는 거부한다.
같은 사람에게 30일에 한 번 이상 보내지 않는다 (`select * from outbox where to_email = … order by id desc`로 확인).

**하지 않는 것**: 수신 동의 없는 콜드메일·문자, 웹에서 이메일 주소 수집 (정보통신망법 제50조, 제50조의2).

## 3. 홍보

### 3-1. 갱신 성과 보기 (매일)

```sql
select * from ops.test_performance limit 30;
```

`share_pct`가 높은 하우스 테스트는 비슷한 주제로 후속작을 만든다. `completion_pct`가 50% 미만이면 질문 수를 줄인 버전을 만든다.

### 3-2. 하우스 테스트 발행 (하루 1개)

시즌·트렌드 주제(신학기, 추석, 연말, 여름휴가, 직장인, 연애, 음식 취향 등)로 테스트를 직접 쓴다. 품질 기준은 `src/lib/ai.ts`의 SYSTEM_PROMPT와 같다.
구조는 `ops/house-tests/*.json` 예시를 따른다. 결과 key는 `r1..rn`, 보기마다 `weights` 1~2개, 모든 결과가 비슷하게 나오도록.

```sql
select ops.create_house_test('<content JSON>'::jsonb,
  '{"cta":{"enabled":true,"label":"우리 브랜드 테스트 만들기","url":"<app_url>/create"}}'::jsonb);
-- 반환된 URL을 3-3 홍보 문구에 사용
```

함수가 구조를 검증해서 오류 문구를 돌려준다. 고쳐서 다시 실행한다.

### 3-3. 채널 콘텐츠 준비

새 테스트마다 채널별 문구를 큐에 넣는다.

```sql
select ops.add_content('threads', '본문…', null, '슬러그');
select ops.add_content('instagram', '캡션…', '카드뉴스 제목', '슬러그', '<app_url>/api/og?slug=슬러그&key=r1');
select ops.add_content('naver_blog', '블로그 원고…', '제목', '슬러그');
```

- 결과 이미지: `<app_url>/api/og?slug=…&key=r1` (1200×630)
- 연결된 채널(예: TikTok 연결 시)은 직접 게시하고 `select ops.mark_content(id, 'posted', '게시 URL');`
- 연결되지 않은 채널은 `draft`로 두고 대표에게 목록을 보고한다.

## 4. 운영팀 제작 요청 처리 (AI 키가 없을 때의 무료 기획 요청)

```sql
select * from ops.generation_queue;
```

요청마다 brief에 맞는 테스트 JSON을 작성해서:

```sql
select ops.fulfill_generation('요청 id', '<content JSON>'::jsonb, '<settings JSON 또는 null>'::jsonb);
```

함수가 초안을 고객 워크스페이스에 만들고 완성 메일을 큐에 넣는다. 24시간 안에 처리한다.

## 5. 메일 발송 상태

```sql
select status, count(*) from outbox group by 1;
select id, to_email, subject, error from outbox where status = 'failed' order by id desc limit 20;
```

`RESEND_API_KEY`가 없으면 메일은 `pending`으로 쌓인다(고객은 문의 페이지에서 답변을 볼 수 있음). 대표에게 키 설정을 요청한다.

## 6. 일일 보고 (실행 끝에)

대표에게 5줄 이내로:
1. 매출·결제 건수, 유료 워크스페이스 수
2. 답변한 문의 수, 대표 확인이 필요한 escalated 목록
3. 새 영업 문의와 처리 상태
4. 발행한 하우스 테스트와 준비한 홍보 콘텐츠
5. 막힌 것 (키 미설정, 채널 미연결 등)

## 절대 하지 않는 것

- 환불·결제 취소·플랜 무상 부여를 대표 승인 없이 하기 (`grant_plan`은 입금 확인·장애 보상 등 대표 승인이 있을 때만)
- 개인정보 삭제·내보내기를 대표 승인 없이 하기
- 수신 동의 없는 사람에게 광고성 메일 보내기
- 테이블을 직접 수정·삭제하기 (반드시 `ops.*` 함수 사용)
- 의학·심리 진단처럼 보이는 테스트, 타사 상표(MBTI 등)를 쓴 테스트 발행

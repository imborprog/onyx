# Phase 1 Verification Rubric (shared by all batch agents)

## Founder profile (assumption — score everything against THIS founder)
- 1~2인 팀, AI 코딩 도구(Claude Code 등)로 직접 개발, 노코드/서버리스(Supabase, Vercel) 활용
- 초기자본 1,000만원 이하, MVP 4~8주 내 출시
- 한국 시장 우선 (글로벌 확장 가능하면 가점)
- 운영 인력 최소화, AI/자동화로 CS·콘텐츠·마케팅 대부분 처리하고 싶음
- 목표: 12개월 내 월 순이익 500만원+

## Scores (integer 1~5 each)
- demand (수요 증거): 5=강한 증거(검색량/경쟁앱 다운로드·매출 큼/커뮤니티 불만 다수), 3=일부 증거, 1=증거 없음
- monetization (지불의사): 5=사람들이 이미 돈을 냄 + 월 9,900원+ 구독 또는 B2B 월 3만원+ 가능, 3=소액 결제/건당 결제 가능, 1=무료 기대치·광고 외 수익 없음
- competition_gap (경쟁 여지): 5=한국어/니치 공백 명확·대기업 미진입, 3=경쟁 있으나 차별화 여지, 1=토스·네이버·카카오·애플·구글 등 무료기능으로 해결되거나 강자 독식
- feasibility (구현 용이성): 5=1인 4주 MVP(기존 API 조합), 3=2~3개월, 1=하드웨어·대규모 독점데이터·인허가 필요
- automation (운영 자동화): 5=CS·운영·콘텐츠 거의 무인 + 한계비용 낮음, 3=부분 수작업, 1=상담·배송·대면영업 등 사람 노동 필수
- promotion (홍보성/오가닉 성장): 5=결과물이 자연스럽게 공유되는 바이럴 루프 또는 SEO/숏폼으로 저비용 획득 쉬움, 3=콘텐츠 마케팅으로 가능, 1=유료광고·대면영업만 가능
- risk_low (리스크 낮음): 5=규제·플랫폼 리스크 거의 없음, 3=관리 가능한 리스크, 1=의료·금융·법률 인허가/민감정보/플랫폼 API 차단 위험 큼

## Weighted score (0~100)
weighted_score = 20 * (0.20*demand + 0.20*monetization + 0.15*competition_gap + 0.15*automation + 0.15*promotion + 0.10*feasibility + 0.05*risk_low)

## kill_flag
치명적 결함이 있으면 한 줄로 기재 (예: "약사법상 불가", "토스에 무료 기능 존재 + 차별화 불가"), 없으면 null.

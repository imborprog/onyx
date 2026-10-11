import type { Metadata } from "next";
import Link from "next/link";
import { isProductId } from "@/lib/config";

export const metadata: Metadata = { title: "결제 실패", robots: { index: false, follow: false } };

// Fixed copy for the codes Toss sends to failUrl. The query string is attacker-controllable, so its
// `message` is never rendered and an unknown code only gets the generic text.
const FAIL_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제를 취소했어요. 결제된 금액은 없어요.",
  PAY_PROCESS_ABORTED: "결제가 중간에 멈췄어요. 결제된 금액은 없으니 다시 시도해 주세요.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 승인하지 않았어요. 카드 정보와 한도를 확인하거나 다른 카드로 시도해 주세요.",
  REJECT_CARD_PAYMENT: "한도 초과나 잔액 부족으로 결제가 거절됐어요. 다른 카드로 시도해 주세요.",
  EXCEED_MAX_DAILY_PAYMENT_COUNT: "오늘 이 카드로 결제할 수 있는 횟수를 넘었어요. 다른 카드로 시도해 주세요.",
  EXCEED_MAX_PAYMENT_AMOUNT: "이 카드의 결제 한도를 넘었어요. 다른 카드로 시도해 주세요.",
  EXCEED_MAX_AMOUNT: "이 카드의 결제 한도를 넘었어요. 다른 카드로 시도해 주세요.",
  INVALID_CARD_EXPIRATION: "카드 유효기간을 확인해 주세요.",
  INVALID_CARD_NUMBER: "카드 번호를 확인해 주세요.",
  INVALID_PASSWORD: "카드 비밀번호가 맞지 않아요.",
  INVALID_STOPPED_CARD: "정지된 카드예요. 다른 카드로 시도해 주세요.",
  INVALID_CARD_LOST_OR_STOLEN: "분실·도난 신고된 카드예요. 다른 카드로 시도해 주세요.",
  EXCEED_MAX_AUTH_COUNT: "인증 시도 횟수를 넘었어요. 잠시 후 다시 시도해 주세요.",
  NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT: "선택한 할부를 이 카드로 쓸 수 없어요. 일시불이나 다른 할부로 시도해 주세요.",
  INVALID_CARD_INSTALLMENT_PLAN: "선택한 할부를 이 카드로 쓸 수 없어요. 일시불이나 다른 할부로 시도해 주세요.",
  NOT_FOUND_PAYMENT_SESSION: "결제 시간이 지나 결제가 취소됐어요. 처음부터 다시 시도해 주세요.",
};

export default async function CheckoutFailPage({ searchParams }: { searchParams: Promise<{ code?: string; product?: string }> }) {
  const { code, product } = await searchParams;
  const known = code && Object.hasOwn(FAIL_MESSAGES, code) ? code : null;
  const retryHref = product && isProductId(product) ? `/checkout?product=${product}` : "/pricing";
  return (
    <div className="narrow center stack" style={{ paddingBlock: 64 }}>
      <h1 className="display" style={{ fontSize: 28 }}>{known === "PAY_PROCESS_CANCELED" ? "결제를 취소했어요" : "결제가 완료되지 않았어요"}</h1>
      <p className="muted">{known ? FAIL_MESSAGES[known] : "결제를 완료하지 못했어요. 결제된 금액은 없으니 다시 시도하거나 문의해 주세요."}</p>
      {known && known !== "PAY_PROCESS_CANCELED" ? <p className="tiny muted">오류 코드: {known}</p> : null}
      <div className="row" style={{ justifyContent: "center" }}>
        <Link href={retryHref} className="btn btn-primary">다시 결제하기</Link>
        <Link href="/support" className="btn btn-ghost">문의하기</Link>
      </div>
    </div>
  );
}

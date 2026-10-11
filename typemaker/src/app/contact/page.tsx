import type { Metadata } from "next";
import { ContactForm } from "@/components/SupportForms";
import { PRODUCTS } from "@/lib/config";

export const metadata: Metadata = { title: "도입 문의", description: "대행사·프랜차이즈·캠페인 기획 대행, 세금계산서 결제 문의" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <div className="stack-lg">
        <div className="stack">
          <h1 className="display" style={{ fontSize: 34 }}>도입 문의</h1>
          <p className="muted">
            기획까지 맡기고 싶다면 캠페인 패스({PRODUCTS.campaign.amount.toLocaleString("ko-KR")}원)를 추천해요. 주제와 목표만 알려 주시면 문항·결과·쿠폰 설계까지 대신 만들어 드려요.
          </p>
        </div>
        <ContactForm defaultProduct={product ?? "campaign"} />
      </div>
    </div>
  );
}

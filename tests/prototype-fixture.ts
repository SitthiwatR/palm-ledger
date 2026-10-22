export function prototypeFixture(prefix: string, photo?: string, demo = false) {
  const record = (
    id: string,
    garden: string,
    kind: "income" | "expense",
    title: string,
    amount: number,
    paid: number,
    category: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id: prefix + id,
    garden: prefix + garden,
    kind,
    title,
    amount,
    paid,
    category,
    date: "2026-09-01",
    party: "",
    note: "จากต้นแบบ",
    payments: [],
    ...extra,
  });
  return {
    version: 1,
    demo,
    gardens: [
      { id: prefix + "a", name: prefix + " สวน A", opening: 500000 },
      { id: prefix + "b", name: prefix + " สวน B", opening: 0 },
    ],
    records: [
      record("sale-a", "a", "income", "ขาย A", 4800000, 4800000, "sale", {
        details: {
          weight: "6000",
          rate: "8",
          deduction: "0",
          receiptNo: prefix + "-sale",
        },
        photo,
      }),
      record("sale-b", "b", "income", "ขาย B", 3000000, 3000000, "sale"),
      record("fert-a", "a", "expense", "ปุ๋ย A", 320000, 200000, "fertilizer", {
        details: { quantity: "4", rate: "800" },
        payments: [{ amount: 50000, date: "2026-09-02" }],
      }),
      record(
        "team-a",
        "a",
        "expense",
        "ทีม A",
        1680000,
        1260000,
        "production",
        { saleId: prefix + "sale-a", photo },
      ),
      record("fert-b", "b", "expense", "ปุ๋ย B", 800000, 800000, "fertilizer", {
        details: { quantity: "10", rate: "800" },
      }),
      record("daily-b", "b", "expense", "รายวัน B", 520000, 320000, "daily", {
        details: { quantity: "13", rate: "400" },
      }),
      record(
        "repair-b",
        "b",
        "expense",
        "ซ่อม B",
        200000,
        200000,
        "maintenance",
        { photo },
      ),
      record("debt", "a", "expense", "หนี้ก่อนระบบ", 100000, 0, "other", {
        opening: true,
        photo,
      }),
    ],
  };
}

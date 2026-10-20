import { Ledger } from "@/ui/ledger";
export default async function Garden({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Ledger view="garden" gardenId={(await params).id} />;
}

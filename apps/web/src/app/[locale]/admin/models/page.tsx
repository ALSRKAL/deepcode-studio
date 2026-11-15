import { redirect } from "next/navigation";

/** Models & prices are administered on the plans page (single table view). */
export default async function AdminModelsPage() {
  redirect("/ar/admin/plans");
}

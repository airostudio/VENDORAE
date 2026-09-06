"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, getTenantId } from "@/lib/data/client";

/**
 * Permanently deletes an order. Its items, payment records and fulfillment log go with it via
 * `on delete cascade`, so this destroys the store's own record of a sale — including, for a paid
 * order, the only local trace of money that actually moved. Stripe keeps its own record either
 * way, and nothing here refunds anything: deleting a paid order does not return the customer's
 * money, it just stops the store showing it. The UI confirms before calling this and says so.
 *
 * Scoped by tenant so an id from another store can't be deleted through this action.
 */
export async function deleteOrder(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) throw new Error("No order id given");

  const tenantId = await getTenantId();
  const { data, error } = await db().from("orders").delete().eq("tenant_id", tenantId).eq("id", orderId).select("id");
  if (error) throw new Error(`Could not delete the order: ${error.message}`);
  if (!data || data.length === 0) throw new Error("That order no longer exists");

  revalidatePath("/admin/orders");
  revalidatePath("/admin");

  // Deleting from the detail page leaves nowhere to go back to.
  if (String(formData.get("returnTo") ?? "") === "list") redirect("/admin/orders");
}

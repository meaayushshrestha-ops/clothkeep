"use client";

import React, { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { createClient } from "@supabase/supabase-js";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/* =========================
   Types
========================= */

interface Variant {
  id: string;
  size: string;
  color: string;
  stock: number;
  price?: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  category?: string;
  cost: number;
  price: number;
  variants: Variant[];
  notes?: string;
  imageUrl?: string;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

interface SaleItem {
  id: string;
  productId: string;
  variantId?: string;
  sku: string;
  name: string;
  size?: string;
  color?: string;
  qty: number;
  price: number;
}

interface Sale {
  id: string;
  createdAt: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: "cash" | "card" | "digital" | "other";
  customerId?: string;
  customerSnapshot?: Partial<Customer>;
  notes?: string;
}

interface Settings {
  storeName: string;
  currency: string;
  taxRateDefault: number;
  lowStockThreshold: number;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

/* =========================
   LocalStorage helpers
========================= */
const LS = {
  settings: "ck_settings",
  products: "ck_products",
  customers: "ck_customers",
  sales: "ck_sales",
};

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* =========================
   Supabase (optional sync)
========================= */

function useSupabase(settings: Settings | null) {
  return React.useMemo(() => {
    if (!settings?.supabaseUrl || !settings?.supabaseAnonKey) return null;
    try {
      return createClient(settings.supabaseUrl, settings.supabaseAnonKey);
    } catch {
      return null;
    }
  }, [settings?.supabaseUrl, settings?.supabaseAnonKey]);
}

async function cloudSync(
  supabase: ReturnType<typeof createClient> | null,
  data: { products: Product[]; customers: Customer[]; sales: Sale[] },
  direction: "push" | "pull"
) {
  if (!supabase) throw new Error("Supabase not configured");

  if (direction === "push") {
    const prodRows = data.products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category ?? null,
      cost: p.cost,
      price: p.price,
      notes: p.notes ?? null,
      image_url: p.imageUrl ?? null,
    }));
    const { error: prodErr } = await supabase.from("products").upsert(prodRows);
    if (prodErr) throw prodErr;

    const varRows = data.products.flatMap((p) =>
      p.variants.map((v) => ({
        id: v.id,
        product_id: p.id,
        size: v.size,
        color: v.color,
        stock: v.stock,
        price: v.price ?? null,
      }))
    );
    const { error: varErr } = await supabase.from("product_variants").upsert(varRows);
    if (varErr) throw varErr;

    const custRows = data.customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      email: c.email ?? null,
      notes: c.notes ?? null,
    }));
    const { error: custErr } = await supabase.from("customers").upsert(custRows);
    if (custErr) throw custErr;

    const saleRows = data.sales.map((s) => ({
      id: s.id,
      created_at: s.createdAt,
      subtotal: s.subtotal,
      discount: s.discount,
      tax_rate: s.taxRate,
      tax_amount: s.taxAmount,
      total: s.total,
      payment_method: s.paymentMethod,
      customer_id: s.customerId ?? null,
      notes: s.notes ?? null,
    }));
    const { error: saleErr } = await supabase.from("sales").upsert(saleRows);
    if (saleErr) throw saleErr;

    const itemRows = data.sales.flatMap((s) =>
      s.items.map((it) => ({
        id: it.id,
        sale_id: s.id,
        product_id: it.productId,
        variant_id: it.variantId ?? null,
        sku: it.sku,
        name: it.name,
        size: it.size ?? null,
        color: it.color ?? null,
        qty: it.qty,
        price: it.price,
      }))
    );
    const { error: itemErr } = await supabase.from("sale_items").upsert(itemRows);
    if (itemErr) throw itemErr;

    return { ok: true };
  } else {
    const [
      { data: prods, error: pErr },
      { data: vars, error: vErr },
      { data: custs, error: cErr },
      { data: sales, error: sErr },
      { data: items, error: iErr },
    ] = await Promise.all([
      supabase.from("products").select("*"),
      supabase.from("product_variants").select("*"),
      supabase.from("customers").select("*"),
      supabase.from("sales").select("*"),
      supabase.from("sale_items").select("*"),
    ]);

    if (pErr || vErr || cErr || sErr || iErr) throw pErr || vErr || cErr || sErr || iErr;

    const products: Product[] = (prods ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category ?? undefined,
      cost: Number(p.cost ?? 0),
      price: Number(p.price ?? 0),
      notes: p.notes ?? undefined,
      imageUrl: p.image_url ?? undefined,
      variants: [],
    }));
    const byProd: Record<string, Product> = Object.fromEntries(products.map((p) => [p.id, p]));
    (vars ?? []).forEach((v: any) => {
      const pv: Variant = {
        id: v.id,
        size: v.size ?? "",
        color: v.color ?? "",
        stock: Number(v.stock ?? 0),
        price: v.price ?? undefined,
      };
      byProd[v.product_id]?.variants.push(pv);
    });

    const customers: Customer[] = (custs ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      notes: c.notes ?? undefined,
    }));

    const saleMap: Record<string, Sale> = {};
    (sales ?? []).forEach((s: any) => {
      saleMap[s.id] = {
        id: s.id,
        createdAt: s.created_at ?? new Date().toISOString(),
        items: [],
        subtotal: Number(s.subtotal ?? 0),
        discount: Number(s.discount ?? 0),
        taxRate: Number(s.tax_rate ?? 0),
        taxAmount: Number(s.tax_amount ?? 0),
        total: Number(s.total ?? 0),
        paymentMethod: (s.payment_method as Sale["paymentMethod"]) ?? "cash",
        customerId: s.customer_id ?? undefined,
        notes: s.notes ?? undefined,
      };
    });
    (items ?? []).forEach((it: any) => {
      const item: SaleItem = {
        id: it.id,
        productId: it.product_id,
        variantId: it.variant_id ?? undefined,
        sku: it.sku ?? "",
        name: it.name ?? "",
        size: it.size ?? undefined,
        color: it.color ?? undefined,
        qty: Number(it.qty ?? 0),
        price: Number(it.price ?? 0),
      };
      if (saleMap[it.sale_id]) saleMap[it.sale_id].items.push(item);
    });

    return { products, customers, sales: Object.values(saleMap) };
  }
}

/* =========================
   Utils & defaults
========================= */
const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const emptySettings: Settings = {
  storeName: "ClothKeep Store",
  currency: "NPR",
  taxRateDefault: 0,
  lowStockThreshold: 5,
  supabaseUrl: "",
  supabaseAnonKey: "",
};

/* =========================
   Main App
========================= */
export default function InventoryPOSApp() {
  const [settings, setSettings] = useState<Settings>(() => loadLS(LS.settings, emptySettings));
  const [products, setProducts] = useState<Product[]>(() => loadLS(LS.products, []));
  const [customers, setCustomers] = useState<Customer[]>(() => loadLS(LS.customers, []));
  const [sales, setSales] = useState<Sale[]>(() => loadLS(LS.sales, []));

  const supabase = useSupabase(settings);

  useEffect(() => saveLS(LS.settings, settings), [settings]);
  useEffect(() => saveLS(LS.products, products), [products]);
  useEffect(() => saveLS(LS.customers, customers), [customers]);
  useEffect(() => saveLS(LS.sales, sales), [sales]);

  const todaySales = useMemo(() => {
    const today = dayjs().format("YYYY-MM-DD");
    return sales.filter((s) => s.createdAt.startsWith(today));
  }, [sales]);

  const inventoryValue = useMemo(() => {
    let cost = 0;
    let retail = 0;
    for (const p of products) {
      for (const v of p.variants) {
        cost += v.stock * p.cost;
        retail += v.stock * (v.price ?? p.price);
      }
    }
    return { cost, retail };
  }, [products]);

  /* -------- Products -------- */
  const [pForm, setPForm] = useState<Omit<Product, "id">>({
    name: "",
    sku: "",
    category: "",
    cost: 0,
    price: 0,
    variants: [],
    notes: "",
    imageUrl: "",
  });

  function addVariantToForm() {
    setPForm((f) => ({
      ...f,
      variants: [...f.variants, { id: uuidv4(), size: "M", color: "Black", stock: 0 }],
    }));
  }
  function removeVariantFromForm(id: string) {
    setPForm((f) => ({ ...f, variants: f.variants.filter((v) => v.id !== id) }));
  }
  function createProduct() {
    if (!pForm.name || !pForm.sku) return alert("Please fill product name and SKU");
    const prod: Product = { id: uuidv4(), ...pForm };
    setProducts((arr) => [prod, ...arr]);
    setPForm({
      name: "",
      sku: "",
      category: "",
      cost: 0,
      price: 0,
      variants: [],
      notes: "",
      imageUrl: "",
    });
  }
  function updateProductStock(prodId: string, variantId: string, delta: number) {
    setProducts((arr) =>
      arr.map((p) =>
        p.id !== prodId
          ? p
          : {
              ...p,
              variants: p.variants.map((v) =>
                v.id === variantId ? { ...v, stock: Math.max(0, v.stock + delta) } : v
              ),
            }
      )
    );
  }

  /* -------- Customers -------- */
  const [cForm, setCForm] = useState<Omit<Customer, "id">>({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });
  function addCustomer() {
    if (!cForm.name) return alert("Customer name required");
    const c: Customer = { id: uuidv4(), ...cForm };
    setCustomers((arr) => [c, ...arr]);
    setCForm({ name: "", phone: "", email: "", notes: "" });
  }

  /* -------- POS / Cart -------- */
  type CartItem = {
    key: string;
    productId: string;
    variantId?: string;
    display: string;
    unitPrice: number;
    qty: number;
    sku: string;
    size?: string;
    color?: string;
  };
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [cartTaxRate, setCartTaxRate] = useState(settings.taxRateDefault);
  const [cartPayment, setCartPayment] = useState<Sale["paymentMethod"]>("cash");
  const [cartCustomerId, setCartCustomerId] = useState<string | undefined>(undefined);

  function addToCart(prodId: string, variantId?: string) {
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    const variant = prod.variants.find((v) => v.id === variantId);
    const unitPrice = variant?.price ?? prod.price;
    const key = uuidv4();
    setCart((arr) => [
      ...arr,
      {
        key,
        productId: prod.id,
        variantId: variant?.id,
        display: prod.name + (variant ? ` (${variant.size}/${variant.color})` : ""),
        unitPrice,
        qty: 1,
        sku: variant ? `${prod.sku}-${variant.size}-${variant.color}` : prod.sku,
        size: variant?.size,
        color: variant?.color,
      },
    ]);
  }

  function addToCartBySku(sku: string) {
    const prod = products.find(
      (p) => p.sku === sku || p.variants.some((v) => `${p.sku}-${v.size}-${v.color}` === sku)
    );
    if (!prod) return alert("SKU not found");
    let v: Variant | undefined;
    if (prod.variants.length) {
      v = prod.variants.find((vv) => `${prod.sku}-${vv.size}-${vv.color}` === sku) || prod.variants[0];
    }
    const unitPrice = v?.price ?? prod.price;
    const key = uuidv4();
    setCart((arr) => [
      ...arr,
      {
        key,
        productId: prod.id,
        variantId: v?.id,
        display: prod.name + (v ? ` (${v.size}/${v.color})` : ""),
        unitPrice,
        qty: 1,
        sku: v ? `${prod.sku}-${v.size}-${v.color}` : prod.sku,
        size: v?.size,
        color: v?.color,
      },
    ]);
  }

  function updateCartQty(key: string, qty: number) {
    setCart((arr) => arr.map((c) => (c.key === key ? { ...c, qty: Math.max(1, qty) } : c)));
  }
  function removeCartItem(key: string) {
    setCart((arr) => arr.filter((c) => c.key !== key));
  }

  const cartTotals = useMemo(() => {
    const subtotal = cart.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    const discounted = Math.max(0, subtotal - cartDiscount);
    const taxAmount = (discounted * cartTaxRate) / 100;
    const total = discounted + taxAmount;
    return { subtotal, discounted, taxAmount, total };
  }, [cart, cartDiscount, cartTaxRate]);

  function generateInvoiceId() {
    const y = dayjs().format("YY");
    const m = dayjs().format("MM");
    const seq = (sales.length + 1).toString().padStart(4, "0");
    return `INV-${y}${m}-${seq}`;
  }

  function checkout() {
    if (!cart.length) return alert("Cart is empty");

    for (const item of cart) {
      const p = products.find((pp) => pp.id === item.productId);
      const v = p?.variants.find((vv) => vv.id === item.variantId);
      if (p && v && v.stock < item.qty) {
        return alert(
          `Not enough stock for ${p.name} (${v.size}/${v.color}). In stock: ${v.stock}`
        );
      }
    }

    const saleId = generateInvoiceId();
    const saleItems: SaleItem[] = cart.map((it) => ({
      id: uuidv4(),
      productId: it.productId,
      variantId: it.variantId,
      sku: it.sku,
      name: it.display,
      size: it.size,
      color: it.color,
      qty: it.qty,
      price: it.unitPrice,
    }));

    const sale: Sale = {
      id: saleId,
      createdAt: dayjs().format("YYYY-MM-DDTHH:mm:ss"),
      items: saleItems,
      subtotal: cartTotals.subtotal,
      discount: cartDiscount,
      taxRate: cartTaxRate,
      taxAmount: cartTotals.taxAmount,
      total: cartTotals.total,
      paymentMethod: cartPayment,
      customerId: cartCustomerId,
      customerSnapshot: cartCustomerId
        ? customers.find((c) => c.id === cartCustomerId) ?? undefined
        : undefined,
    };

    setProducts((arr) =>
      arr.map((p) => {
        const relatedItems = saleItems.filter((it) => it.productId === p.id && it.variantId);
        if (!relatedItems.length) return p;
        return {
          ...p,
          variants: p.variants.map((v) => {
            const it = relatedItems.find((ri) => ri.variantId === v.id);
            return it ? { ...v, stock: Math.max(0, v.stock - it.qty) } : v;
          }),
        };
      })
    );

    setSales((arr) => [sale, ...arr]);
    setCart([]);
    setCartDiscount(0);
    setCartTaxRate(settings.taxRateDefault);
    alert(`Sale completed! Invoice #${saleId}`);
  }

  /* -------- Import/Export -------- */
  function exportJSON() {
    const payload = { settings, products, customers, sales };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clothkeep-backup-${dayjs().format("YYYYMMDD-HHmmss")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.settings) setSettings(data.settings);
        if (data.products) setProducts(data.products);
        if (data.customers) setCustomers(data.customers);
        if (data.sales) setSales(data.sales);
        alert("Import successful");
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  async function pushToCloud() {
    if (!supabase) return alert("Add Supabase URL & Key in Settings first.");
    try {
      await cloudSync(supabase, { products, customers, sales }, "push");
      alert("Pushed to cloud ✔");
    } catch (e: any) {
      alert(`Cloud push failed: ${e.message || e}`);
    }
  }
  async function pullFromCloud() {
    if (!supabase) return alert("Add Supabase URL & Key in Settings first.");
    try {
      const data = await cloudSync(supabase, { products, customers, sales }, "pull");
      if (data) {
        setProducts(data.products);
        setCustomers(data.customers);
        setSales(data.sales);
      }
      alert("Pulled from cloud ✔");
    } catch (e: any) {
      alert(`Cloud pull failed: ${e.message || e}`);
    }
  }

  /* =========================
     UI
  ========================= */
  return (
    <div className="min-h-screen w-full bg-gray-50">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-black text-white grid place-items-center font-bold">
              CK
            </div>
            <div>
              <div className="text-lg font-semibold leading-tight">
                {settings.storeName || "ClothKeep"}
              </div>
              <div className="text-xs text-gray-500">Inventory · POS · Customers</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="hidden sm:inline-flex" onClick={exportJSON}>
              Backup JSON
            </Button>
            <Label htmlFor="importJson" className="sr-only">
              Import JSON
            </Label>
            <Input
              id="importJson"
              type="file"
              accept="application/json"
              onChange={importJSON}
              className="max-w-[210px]"
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <Tabs defaultValue="pos" className="w-full">
          <TabsList className="grid grid-cols-2 sm:grid-cols-5">
            <TabsTrigger value="pos">POS</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* POS */}
          <TabsContent value="pos">
            <div className="grid md:grid-cols-3 gap-4">
              {/* Left: product picker */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>New Sale</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 items-end flex-wrap">
                    <div className="min-w-[200px]">
                      <Label>Quick Add by SKU</Label>
                      <div className="flex gap-2">
                        <Input id="skuInput" placeholder="e.g. TEE-001-M-Black" />
                        <Button
                          onClick={() => {
                            const el = document.getElementById("skuInput") as HTMLInputElement | null;
                            if (!el?.value) return;
                            addToCartBySku(el.value.trim());
                            el.value = "";
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                    <div className="flex-1" />
                    <div className="text-sm text-gray-500">{products.length} products</div>
                  </div>

                  <div className="max-h-[360px] overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>SKU / Variant</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-center">Stock</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((p) =>
                          p.variants.length ? (
                            p.variants.map((v) => (
                              <TableRow key={v.id}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell>
                                  <div className="text-xs text-gray-500">
                                    {`${p.sku}-${v.size}-${v.color}`}
                                  </div>
                                  <div className="text-sm">
                                    {v.size} / {v.color}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {money(v.price ?? p.price, settings.currency)}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge
                                    variant={
                                      v.stock <= settings.lowStockThreshold ? "destructive" : "secondary"
                                    }
                                  >
                                    {v.stock}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" onClick={() => addToCart(p.id, v.id)}>
                                    Add
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow key={p.id}>
                              <TableCell className="font-medium">{p.name}</TableCell>
                              <TableCell>
                                <div className="text-xs text-gray-500">{p.sku}</div>
                                <div className="text-sm">—</div>
                              </TableCell>
                              <TableCell className="text-right">{money(p.price, settings.currency)}</TableCell>
                              <TableCell className="text-center">—</TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" onClick={() => addToCart(p.id)}>
                                  Add
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Right: cart */}
              <Card>
                <CardHeader>
                  <CardTitle>Cart</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="max-h-[280px] overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-center">Qty</TableHead>
                          <TableHead className="text-right">Unit</TableHead>
                          <TableHead className="text-right">Line</TableHead>
                          <TableHead className="text-right">—</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cart.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-gray-400">
                              No items
                            </TableCell>
                          </TableRow>
                        )}
                        {cart.map((it) => (
                          <TableRow key={it.key}>
                            <TableCell>
                              <div className="font-medium text-sm">{it.display}</div>
                              <div className="text-xs text-gray-500">{it.sku}</div>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="secondary"
                                  onClick={() => updateCartQty(it.key, it.qty - 1)}
                                >
                                  -
                                </Button>
                                <Input
                                  type="number"
                                  value={it.qty}
                                  onChange={(e) => updateCartQty(it.key, Number(e.target.value))}
                                  className="w-14 text-center"
                                  min={1}
                                />
                                <Button
                                  size="icon"
                                  variant="secondary"
                                  onClick={() => updateCartQty(it.key, it.qty + 1)}
                                >
                                  +
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{money(it.unitPrice, settings.currency)}</TableCell>
                            <TableCell className="text-right">
                              {money(it.unitPrice * it.qty, settings.currency)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="icon" variant="ghost" onClick={() => removeCartItem(it.key)}>
                                ✕
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Discount (absolute)</Label>
                      <Input
                        type="number"
                        value={cartDiscount}
                        onChange={(e) => setCartDiscount(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label>Tax %</Label>
                      <Input
                        type="number"
                        value={cartTaxRate}
                        onChange={(e) => setCartTaxRate(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label>Payment</Label>
                      <Select value={cartPayment} onValueChange={(v: any) => setCartPayment(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="digital">Digital</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Customer (optional)</Label>
                      <Select
                        value={cartCustomerId ?? "walkin"}
                        onValueChange={(v) => setCartCustomerId(v === "walkin" ? undefined : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Walk-in" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="walkin">Walk-in</SelectItem>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{money(cartTotals.subtotal, settings.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount</span>
                      <span>- {money(cartDiscount, settings.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax ({cartTaxRate}%)</span>
                      <span>{money(cartTotals.taxAmount, settings.currency)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-base border-t pt-2">
                      <span>Total</span>
                      <span>{money(cartTotals.total, settings.currency)}</span>
                    </div>
                  </div>

                  <Button className="w-full h-11 text-base" onClick={checkout}>
                    Checkout
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Products */}
          <TabsContent value="products">
            <div className="grid lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle>Add Product</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>SKU</Label>
                      <Input
                        value={pForm.sku}
                        onChange={(e) => setPForm({ ...pForm, sku: e.target.value })}
                        placeholder="e.g. TEE-001"
                      />
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Input
                        value={pForm.category}
                        onChange={(e) => setPForm({ ...pForm, category: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Cost</Label>
                      <Input
                        type="number"
                        value={pForm.cost}
                        onChange={(e) => setPForm({ ...pForm, cost: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Default Price</Label>
                      <Input
                        type="number"
                        value={pForm.price}
                        onChange={(e) => setPForm({ ...pForm, price: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Image URL (optional)</Label>
                    <Input
                      value={pForm.imageUrl}
                      onChange={(e) => setPForm({ ...pForm, imageUrl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={pForm.notes} onChange={(e) => setPForm({ ...pForm, notes: e.target.value })} />
                  </div>

                  <div className="border rounded-lg p-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">Variants</div>
                      <Button size="sm" variant="secondary" onClick={addVariantToForm}>
                        + Add variant
                      </Button>
                    </div>
                    {pForm.variants.length === 0 && (
                      <div className="text-sm text-gray-500">
                        No variants yet. Add size/color rows (e.g., M · Black).
                      </div>
                    )}
                    <div className="space-y-2">
                      {pForm.variants.map((v) => (
                        <div key={v.id} className="grid grid-cols-5 gap-2 items-end">
                          <div>
                            <Label>Size</Label>
                            <Input
                              value={v.size}
                              onChange={(e) =>
                                setPForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((vv) =>
                                    vv.id === v.id ? { ...vv, size: e.target.value } : vv
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label>Color</Label>
                            <Input
                              value={v.color}
                              onChange={(e) =>
                                setPForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((vv) =>
                                    vv.id === v.id ? { ...vv, color: e.target.value } : vv
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label>Stock</Label>
                            <Input
                              type="number"
                              value={v.stock}
                              onChange={(e) =>
                                setPForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((vv) =>
                                    vv.id === v.id ? { ...vv, stock: Number(e.target.value) } : vv
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label>Price (opt)</Label>
                            <Input
                              type="number"
                              value={v.price ?? 0}
                              onChange={(e) =>
                                setPForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((vv) =>
                                    vv.id === v.id
                                      ? { ...vv, price: Number(e.target.value) || undefined }
                                      : vv
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="flex items-end justify-end">
                            <Button variant="ghost" onClick={() => removeVariantFromForm(v.id)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button className="w-full" onClick={createProduct}>
                    Save Product
                  </Button>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Inventory</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto rounded-lg border max-h-[520px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Variant</TableHead>
                          <TableHead className="text-center">Stock</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Adjust</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((p) =>
                          p.variants.length ? (
                            p.variants.map((v) => (
                              <TableRow key={v.id}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell>{p.sku}</TableCell>
                                <TableCell>
                                  {v.size} / {v.color}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge
                                    variant={
                                      v.stock <= settings.lowStockThreshold ? "destructive" : "secondary"
                                    }
                                  >
                                    {v.stock}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">{money(p.cost, settings.currency)}</TableCell>
                                <TableCell className="text-right">
                                  {money(v.price ?? p.price, settings.currency)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="inline-flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => updateProductStock(p.id, v.id, -1)}
                                    >
                                      -1
                                    </Button>
                                    <Button size="sm" onClick={() => updateProductStock(p.id, v.id, +1)}>
                                      +1
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow key={p.id}>
                              <TableCell className="font-medium">{p.name}</TableCell>
                              <TableCell>{p.sku}</TableCell>
                              <TableCell>—</TableCell>
                              <TableCell className="text-center">—</TableCell>
                              <TableCell className="text-right">{money(p.cost, settings.currency)}</TableCell>
                              <TableCell className="text-right">{money(p.price, settings.currency)}</TableCell>
                              <TableCell className="text-right">—</TableCell>
                            </TableRow>
                          )
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Customers */}
          <TabsContent value="customers">
            <div className="grid lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Add Customer</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Phone</Label>
                      <Input value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={cForm.email}
                        onChange={(e) => setCForm({ ...cForm, email: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={cForm.notes} onChange={(e) => setCForm({ ...cForm, notes: e.target.value })} />
                  </div>
                  <Button className="w-full" onClick={addCustomer}>
                    Save Customer
                  </Button>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Customer List</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto rounded-lg border max-h-[520px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customers.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.name}</TableCell>
                            <TableCell>{c.phone || "—"}</TableCell>
                            <TableCell>{c.email || "—"}</TableCell>
                            <TableCell className="max-w-[320px] truncate" title={c.notes}>
                              {c.notes || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                        {customers.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-gray-400">
                              No customers yet
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reports */}
          <TabsContent value="reports">
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Today’s Sales</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-3xl font-semibold">
                    {money(todaySales.reduce((s, x) => s + x.total, 0), settings.currency)}
                  </div>
                  <div className="text-sm text-gray-500">Invoices: {todaySales.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Inventory Value</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>At cost</span>
                    <span>{money(inventoryValue.cost, settings.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>At retail</span>
                    <span>{money(inventoryValue.retail, settings.currency)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Low Stock</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm max-h-[180px] overflow-auto">
                    {products
                      .flatMap((p) => p.variants.map((v) => ({ p, v })))
                      .filter(({ v }) => v.stock <= settings.lowStockThreshold)
                      .map(({ p, v }) => (
                        <li key={v.id} className="flex justify-between">
                          <span>
                            {p.name} <span className="text-gray-500">({v.size}/{v.color})</span>
                          </span>
                          <span className="font-medium">{v.stock}</span>
                        </li>
                      ))}
                    {products.length &&
                    products.flatMap((p) => p.variants).filter((v) => v.stock <= settings.lowStockThreshold)
                      .length === 0 ? (
                      <div className="text-gray-400">All good!</div>
                    ) : null}
                  </ul>
                </CardContent>
              </Card>

              <Card className="md:col-span-3">
                <CardHeader>
                  <CardTitle>Sales History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto rounded-lg border max-h-[480px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Items</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sales.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.id}</TableCell>
                            <TableCell>{dayjs(s.createdAt).format("MMM D, YYYY HH:mm")}</TableCell>
                            <TableCell>{s.customerSnapshot?.name || "Walk-in"}</TableCell>
                            <TableCell>{s.items.length}</TableCell>
                            <TableCell className="text-right">{money(s.total, settings.currency)}</TableCell>
                          </TableRow>
                        ))}
                        {sales.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-gray-400">
                              No sales yet
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Store Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Store name</Label>
                    <Input
                      value={settings.storeName}
                      onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Currency</Label>
                      <Input
                        value={settings.currency}
                        onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                        placeholder="NPR"
                      />
                    </div>
                    <div>
                      <Label>Default Tax %</Label>
                      <Input
                        type="number"
                        value={settings.taxRateDefault}
                        onChange={(e) =>
                          setSettings({ ...settings, taxRateDefault: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Low stock threshold</Label>
                    <Input
                      type="number"
                      value={settings.lowStockThreshold}
                      onChange={(e) =>
                        setSettings({ ...settings, lowStockThreshold: Number(e.target.value) })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Cloud Sync (optional)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Supabase URL</Label>
                    <Input
                      value={settings.supabaseUrl || ""}
                      onChange={(e) => setSettings({ ...settings, supabaseUrl: e.target.value })}
                      placeholder="https://YOUR-PROJECT.supabase.co"
                    />
                  </div>
                  <div>
                    <Label>Supabase Anon Key</Label>
                    <Input
                      value={settings.supabaseAnonKey || ""}
                      onChange={(e) => setSettings({ ...settings, supabaseAnonKey: e.target.value })}
                      placeholder="Paste anon public key"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={pullFromCloud}>
                      Pull
                    </Button>
                    <Button onClick={pushToCloud}>Push</Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Tip: Use the anon <em>public</em> key. Configure RLS policies if you enable it.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <footer className="mt-8 text-center text-xs text-gray-500">
          Built with ❤ for clothing stores. Mobile-friendly: open this page on your phone to use POS.
        </footer>
      </main>
    </div>
  );
}

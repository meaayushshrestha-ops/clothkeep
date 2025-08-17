"use client";

import React, { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* shadcn/ui */
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
  size: string; // e.g. S, M, L, XL
  color: string; // e.g. Black
  stock: number; // units on hand
  price?: number; // optional override
}

interface Product {
  id: string;
  name: string;
  sku: string;
  category?: string;
  cost: number; // unit cost
  price: number; // default sell price
  variants: Variant[]; // [] means single-SKU
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
  price: number; // effective price per unit
}

interface Sale {
  id: string;
  createdAt: string; // YYYY-MM-DD HH:mm
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: "cash" | "card" | "upi";
  customerId?: string;
  notes?: string;
  items: SaleItem[];
}

interface Settings {
  storeName: string;
  currency: string;
  taxRateDefault: number; // %
  lowStockThreshold: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/* =========================
   Constants & helpers
   ========================= */
const LS = {
  settings: "jg_settings",
  products: "jg_products",
  customers: "jg_customers",
  sales: "jg_sales",
};

const emptySettings: Settings = {
  storeName: "JOHNY GEAR STORE",
  currency: "NPR",
  taxRateDefault: 0,
  lowStockThreshold: 5,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
};

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function initialsFrom(name: string) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "JG";
}

function useSupabase(settings: Settings): SupabaseClient | null {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey) return null;
  try {
    return createClient(settings.supabaseUrl, settings.supabaseAnonKey);
  } catch {
    return null;
  }
}

/* =========================
   The Page Component
   ========================= */
export default function Page() {
  /* ----- state ----- */
  const [settings, setSettings] = useState<Settings>(() =>
    loadLS(LS.settings, emptySettings)
  );
  const [products, setProducts] = useState<Product[]>(() =>
    loadLS(LS.products, [])
  );
  const [customers, setCustomers] = useState<Customer[]>(() =>
    loadLS(LS.customers, [])
  );
  const [sales, setSales] = useState<Sale[]>(() => loadLS(LS.sales, []));

  const supabase = useSupabase(settings);

  // initials for the little circle badge
  const initials = useMemo(
    () => initialsFrom(settings.storeName || "JOHNY GEAR STORE"),
    [settings.storeName]
  );

  // persist to localStorage when state changes
  useEffect(() => saveLS(LS.settings, settings), [settings]);
  useEffect(() => saveLS(LS.products, products), [products]);
  useEffect(() => saveLS(LS.customers, customers), [customers]);
  useEffect(() => saveLS(LS.sales, sales), [sales]);

  /* ----- computed ----- */
  const todaySales = useMemo(() => {
    const today = dayjs().format("YYYY-MM-DD");
    return sales.filter((s) => s.createdAt.startsWith(today));
  }, [sales]);

  const inventoryValue = useMemo(() => {
    let cost = 0;
    let retail = 0;
    for (const p of products) {
      if (!p.variants.length) {
        cost += p.cost * 1;
        retail += p.price * 1;
      }
      for (const v of p.variants) {
        cost += v.stock * p.cost;
        retail += v.stock * (v.price ?? p.price);
      }
    }
    return { cost, retail };
  }, [products]);

  /* =========================
     POS state & handlers
     ========================= */
  const [posProductId, setPosProductId] = useState<string>("");
  const [posVariantId, setPosVariantId] = useState<string>("");
  const [posQty, setPosQty] = useState<number>(1);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "upi">(
    "cash"
  );
  const [saleNotes, setSaleNotes] = useState("");

  const posProduct = products.find((p) => p.id === posProductId) || null;
  const posVariant =
    posProduct?.variants.find((v) => v.id === posVariantId) || null;

  const addToCart = () => {
    if (!posProduct) return;
    const price = (posVariant?.price ?? posProduct.price) || 0;
    const sku = posVariant
      ? `${posProduct.sku}-${posVariant.size}-${posVariant.color}`
      : posProduct.sku;

    const item: SaleItem = {
      id: uuidv4(),
      productId: posProduct.id,
      variantId: posVariant?.id,
      sku,
      name: posProduct.name,
      size: posVariant?.size,
      color: posVariant?.color,
      qty: Math.max(1, posQty),
      price,
    };
    setCart((c) => [...c, item]);
  };

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, it) => sum + it.price * it.qty, 0),
    [cart]
  );
  const cartTaxRate = settings.taxRateDefault;
  const cartTaxAmount = (cartSubtotal * cartTaxRate) / 100;
  const cartTotal = cartSubtotal + cartTaxAmount;

  const completeSale = async () => {
    if (!cart.length) return;

    const sale: Sale = {
      id: uuidv4(),
      createdAt: dayjs().format("YYYY-MM-DD HH:mm"),
      subtotal: cartSubtotal,
      discount: 0,
      taxRate: cartTaxRate,
      taxAmount: cartTaxAmount,
      total: cartTotal,
      paymentMethod,
      notes: saleNotes || undefined,
      items: cart,
    };

    // deduct stock locally
    const nextProducts = products.map((p) => {
      const related = cart.filter((c) => c.productId === p.id);
      if (!related.length) return p;
      const variants = p.variants.map((v) => {
        const used = related
          .filter((c) => c.variantId === v.id)
          .reduce((q, c) => q + c.qty, 0);
        return { ...v, stock: Math.max(0, v.stock - used) };
      });
      return { ...p, variants };
    });

    setProducts(nextProducts);
    setSales((s) => [sale, ...s]);
    setCart([]);
    setSaleNotes("");

    // optional: store to supabase if configured
    try {
      if (supabase) {
        await supabase.from("sales").insert({
          id: sale.id,
          subtotal: sale.subtotal,
          discount: sale.discount,
          tax_rate: sale.taxRate,
          tax_amount: sale.taxAmount,
          total: sale.total,
          payment_method: sale.paymentMethod,
          notes: sale.notes ?? null,
          created_at: sale.createdAt,
        });
        for (const it of sale.items) {
          await supabase.from("sale_items").insert({
            id: it.id,
            sale_id: sale.id,
            product_id: it.productId,
            variant_id: it.variantId ?? null,
            sku: it.sku,
            name: it.name,
            size: it.size ?? null,
            color: it.color ?? null,
            qty: it.qty,
            price: it.price,
          });
        }
      }
    } catch {
      /* ignore for now */
    }
    alert("Sale completed!");
  };

  /* =========================
     CRUD helpers for products/customers
     ========================= */
  const [newP, setNewP] = useState<Partial<Product>>({
    name: "",
    sku: "",
    cost: 0,
    price: 0,
    category: "general",
    variants: [],
    notes: "",
  });
  const addVariantToNew = () =>
    setNewP((p) => ({
      ...(p as Product),
      variants: [
        ...(p?.variants ?? []),
        { id: uuidv4(), size: "M", color: "Black", stock: 0, price: undefined },
      ],
    }));
  const removeVariantFromNew = (id: string) =>
    setNewP((p) => ({
      ...(p as Product),
      variants: (p?.variants ?? []).filter((v) => v.id !== id),
    }));
  const saveNewProduct = () => {
    if (!newP.name || !newP.sku) {
      alert("Name and SKU are required");
      return;
    }
    const prod: Product = {
      id: uuidv4(),
      name: newP.name!,
      sku: newP.sku!,
      category: newP.category || "general",
      cost: Number(newP.cost || 0),
      price: Number(newP.price || 0),
      variants: (newP.variants ?? []).map((v) => ({
        id: v.id || uuidv4(),
        size: v.size || "",
        color: v.color || "",
        stock: Number(v.stock || 0),
        price: v.price === undefined ? undefined : Number(v.price),
      })),
      notes: newP.notes || "",
    };
    setProducts((ps) => [prod, ...ps]);
    setNewP({
      name: "",
      sku: "",
      cost: 0,
      price: 0,
      category: "general",
      variants: [],
      notes: "",
    });
  };

  const [newC, setNewC] = useState<Partial<Customer>>({
    name: "",
    phone: "",
    email: "",
  });
  const saveNewCustomer = () => {
    if (!newC.name) {
      alert("Customer name required");
      return;
    }
    const c: Customer = {
      id: uuidv4(),
      name: newC.name!,
      phone: newC.phone || "",
      email: newC.email || "",
      notes: newC.notes || "",
    };
    setCustomers((cs) => [c, ...cs]);
    setNewC({ name: "", phone: "", email: "" });
  };

  /* =========================
     Import / Export JSON (backup)
     ========================= */
  const exportJSON = () => {
    const blob = new Blob(
      [JSON.stringify({ settings, products, customers, sales }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `johnygear-backup-${dayjs().format("YYYYMMDD-HHmmss")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (data.settings) setSettings(data.settings);
      if (data.products) setProducts(data.products);
      if (data.customers) setCustomers(data.customers);
      if (data.sales) setSales(data.sales);
      alert("Import complete.");
    } catch {
      alert("Invalid JSON file.");
    }
    e.currentTarget.value = "";
  };

  /* =========================
     UI
     ========================= */
  return (
    <div className="min-h-screen w-full bg-gray-50">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-black text-white grid place-items-center font-bold">
              {initials}
            </div>
            <div>
              <div className="text-lg font-semibold leading-tight">
                {settings.storeName || "JOHNY GEAR STORE"}
              </div>
              <div className="text-xs text-gray-500">
                Inventory · POS · Customers
              </div>
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
              className="max-w-[210px]"
              onChange={importJSON}
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <Tabs defaultValue="pos" className="w-full">
          <TabsList className="grid grid-cols-5 gap-2 w-full">
            <TabsTrigger value="pos">POS</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* POS */}
          <TabsContent value="pos">
            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>New Sale / Cart</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {/* Product picker */}
                    <div>
                      <Label>Product</Label>
                      <Select
                        value={posProductId}
                        onValueChange={(v) => {
                          setPosProductId(v);
                          setPosVariantId("");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Variant picker */}
                    <div>
                      <Label>Variant</Label>
                      <Select
                        value={posVariantId}
                        onValueChange={setPosVariantId}
                        disabled={!posProduct || posProduct.variants.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              posProduct?.variants.length
                                ? "Select variant"
                                : "No variants"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(posProduct?.variants ?? []).map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.size} / {v.color} — Stock {v.stock} —{" "}
                              {money(v.price ?? posProduct!.price, settings.currency)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={posQty}
                        onChange={(e) => setPosQty(Math.max(1, Number(e.target.value || 1)))}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={addToCart} disabled={!posProduct}>
                      Add to cart
                    </Button>
                    <Badge variant="outline">
                      Subtotal: {money(cartSubtotal, settings.currency)}
                    </Badge>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cart.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                          <TableCell>
                            {it.name}
                            {it.size || it.color ? (
                              <span className="text-muted-foreground text-xs">
                                {" "}
                                ({it.size ?? ""}{it.size && it.color ? " · " : ""}{it.color ?? ""})
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>{it.qty}</TableCell>
                          <TableCell className="text-right">
                            {money(it.price * it.qty, settings.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="flex flex-wrap items-center gap-3 justify-end pt-2">
                    <Badge variant="secondary">
                      Tax {cartTaxRate}% = {money(cartTaxAmount, settings.currency)}
                    </Badge>
                    <Badge className="text-base">
                      Total {money(cartTotal, settings.currency)}
                    </Badge>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3 pt-2">
                    <div>
                      <Label>Payment</Label>
                      <Select
                        value={paymentMethod}
                        onValueChange={(v: "cash" | "card" | "upi") => setPaymentMethod(v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="upi">UPI</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Notes</Label>
                      <Textarea
                        value={saleNotes}
                        onChange={(e) => setSaleNotes(e.target.value)}
                        placeholder="Optional note for this sale"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={completeSale} disabled={!cart.length}>
                      Complete Sale
                    </Button>
                    <Button variant="secondary" onClick={() => setCart([])} disabled={!cart.length}>
                      Clear Cart
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Quick stats */}
              <div className="grid gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Today</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span>Sales count</span>
                      <Badge>{todaySales.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Inventory @ Retail</span>
                      <Badge variant="outline">
                        {money(inventoryValue.retail, settings.currency)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Low Stock</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 max-h-[220px] overflow-auto">
                    {products.flatMap((p) =>
                      p.variants
                        .filter((v) => v.stock <= settings.lowStockThreshold)
                        .map((v) => (
                          <div key={v.id} className="text-sm flex justify-between">
                            <span>
                              {p.name} — {v.size}/{v.color}
                            </span>
                            <Badge variant="destructive">Stock {v.stock}</Badge>
                          </div>
                        ))
                    )}
                    {!products.some((p) =>
                      p.variants.some((v) => v.stock <= settings.lowStockThreshold)
                    ) && <div className="text-muted-foreground text-sm">All good 👍</div>}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Products */}
          <TabsContent value="products">
            <div className="grid lg:grid-cols-3 gap-4 mt-4">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle>Add Product</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={newP.name ?? ""}
                      onChange={(e) => setNewP((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>SKU</Label>
                    <Input
                      value={newP.sku ?? ""}
                      onChange={(e) => setNewP((p) => ({ ...p, sku: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Cost</Label>
                      <Input
                        type="number"
                        value={String(newP.cost ?? 0)}
                        onChange={(e) =>
                          setNewP((p) => ({ ...p, cost: Number(e.target.value || 0) }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Price</Label>
                      <Input
                        type="number"
                        value={String(newP.price ?? 0)}
                        onChange={(e) =>
                          setNewP((p) => ({ ...p, price: Number(e.target.value || 0) }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={newP.category || "general"}
                      onValueChange={(v) => setNewP((p) => ({ ...p, category: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="tops">Tops</SelectItem>
                        <SelectItem value="bottoms">Bottoms</SelectItem>
                        <SelectItem value="outerwear">Outerwear</SelectItem>
                        <SelectItem value="accessories">Accessories</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Variants</Label>
                      <Button size="sm" variant="secondary" onClick={addVariantToNew}>
                        + Add Variant
                      </Button>
                    </div>
                    {(newP.variants ?? []).map((v, idx) => (
                      <div
                        key={v.id}
                        className="grid grid-cols-5 gap-2 border rounded-lg p-2 bg-white"
                      >
                        <Input
                          placeholder="Size"
                          value={v.size}
                          onChange={(e) =>
                            setNewP((p) => {
                              const vs = [...(p?.variants ?? [])];
                              vs[idx] = { ...vs[idx], size: e.target.value };
                              return { ...(p as Product), variants: vs };
                            })
                          }
                        />
                        <Input
                          placeholder="Color"
                          value={v.color}
                          onChange={(e) =>
                            setNewP((p) => {
                              const vs = [...(p?.variants ?? [])];
                              vs[idx] = { ...vs[idx], color: e.target.value };
                              return { ...(p as Product), variants: vs };
                            })
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Stock"
                          value={String(v.stock)}
                          onChange={(e) =>
                            setNewP((p) => {
                              const vs = [...(p?.variants ?? [])];
                              vs[idx] = { ...vs[idx], stock: Number(e.target.value || 0) };
                              return { ...(p as Product), variants: vs };
                            })
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Override Price"
                          value={v.price === undefined ? "" : String(v.price)}
                          onChange={(e) =>
                            setNewP((p) => {
                              const raw = e.target.value;
                              const val = raw === "" ? undefined : Number(raw);
                              const vs = [...(p?.variants ?? [])];
                              vs[idx] = { ...vs[idx], price: val as number | undefined };
                              return { ...(p as Product), variants: vs };
                            })
                          }
                        />
                        <Button
                          variant="destructive"
                          onClick={() => removeVariantFromNew(v.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      value={newP.notes ?? ""}
                      onChange={(e) => setNewP((p) => ({ ...p, notes: e.target.value }))}
                    />
                  </div>

                  <Button onClick={saveNewProduct}>Save Product</Button>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Inventory</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.flatMap((p) =>
                        p.variants.length
                          ? p.variants.map((v) => (
                              <TableRow key={v.id}>
                                <TableCell className="font-mono text-xs">
                                  {p.sku}-{v.size}-{v.color}
                                </TableCell>
                                <TableCell>{p.name}</TableCell>
                                <TableCell>
                                  {v.size}/{v.color}
                                </TableCell>
                                <TableCell className="text-right">{v.stock}</TableCell>
                                <TableCell className="text-right">
                                  {money(v.price ?? p.price, settings.currency)}
                                </TableCell>
                              </TableRow>
                            ))
                          : [
                              <TableRow key={p.id}>
                                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                                <TableCell>{p.name}</TableCell>
                                <TableCell>—</TableCell>
                                <TableCell className="text-right">1</TableCell>
                                <TableCell className="text-right">
                                  {money(p.price, settings.currency)}
                                </TableCell>
                              </TableRow>,
                            ]
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Customers */}
          <TabsContent value="customers">
            <div className="grid lg:grid-cols-3 gap-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Add Customer</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={newC.name ?? ""}
                      onChange={(e) => setNewC((c) => ({ ...c, name: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Phone</Label>
                      <Input
                        value={newC.phone ?? ""}
                        onChange={(e) => setNewC((c) => ({ ...c, phone: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={newC.email ?? ""}
                        onChange={(e) => setNewC((c) => ({ ...c, email: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      value={newC.notes ?? ""}
                      onChange={(e) => setNewC((c) => ({ ...c, notes: e.target.value }))}
                    />
                  </div>
                  <Button onClick={saveNewCustomer}>Save Customer</Button>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Customers</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Email</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>{c.name}</TableCell>
                          <TableCell>{c.phone}</TableCell>
                          <TableCell>{c.email}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reports */}
          <TabsContent value="reports">
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Sales (Today)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {todaySales.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{s.createdAt}</span>
                      <span>{money(s.total, settings.currency)}</span>
                    </div>
                  ))}
                  {!todaySales.length && (
                    <div className="text-muted-foreground text-sm">No sales yet today.</div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Inventory Value</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span>Cost</span>
                    <Badge variant="outline">
                      {money(inventoryValue.cost, settings.currency)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Retail</span>
                    <Badge>{money(inventoryValue.retail, settings.currency)}</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings">
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Store</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Store Name</Label>
                    <Input
                      value={settings.storeName}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, storeName: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Currency (ISO)</Label>
                      <Input
                        value={settings.currency}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, currency: e.target.value.toUpperCase() }))
                        }
                        placeholder="NPR, USD, INR…"
                      />
                    </div>
                    <div>
                      <Label>Tax %</Label>
                      <Input
                        type="number"
                        value={String(settings.taxRateDefault)}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            taxRateDefault: Number(e.target.value || 0),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Low Stock Threshold</Label>
                    <Input
                      type="number"
                      value={String(settings.lowStockThreshold)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          lowStockThreshold: Number(e.target.value || 0),
                        }))
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Cloud Sync (Supabase, optional)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <Label>SUPABASE URL</Label>
                    <Input
                      value={settings.supabaseUrl}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, supabaseUrl: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>SUPABASE ANON KEY</Label>
                    <Input
                      value={settings.supabaseAnonKey}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, supabaseAnonKey: e.target.value }))
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tip: set these in Vercel environment variables to prefill for all devices.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

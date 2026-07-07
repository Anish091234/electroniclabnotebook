import { useState, type FormEvent } from "react";
import "./Dashboard.css";
import "./Inventory.css";
import type { InventoryItem } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";

const EMPTY_FORM = {
  id: "",
  lotId: "",
  name: "",
  category: "",
  vendor: "",
  catalogNumber: "",
  unit: "mL",
  lotNumber: "",
  location: "",
  quantity: 1,
  expirationDate: "",
  notes: "",
};

export function Inventory() {
  const { inventoryItems, saveInventoryItem, adjustInventoryLot } = useLabData();
  const { activeMember } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const canManageInventory = activeMember?.role === "owner" || activeMember?.role === "admin" || activeMember?.role === "pi";

  const edit = (item: InventoryItem) => {
    const lot = item.lots[0];
    setForm({
      id: item.id,
      lotId: lot?.id ?? "",
      name: item.name,
      category: item.category,
      vendor: item.vendor,
      catalogNumber: item.catalogNumber,
      unit: item.unit,
      lotNumber: lot?.lotNumber ?? "",
      location: lot?.location ?? "",
      quantity: lot?.quantity ?? 1,
      expirationDate: lot?.expirationDate ?? "",
      notes: lot?.notes ?? "",
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await saveInventoryItem({
      id: form.id || undefined,
      name: form.name,
      category: form.category,
      vendor: form.vendor,
      catalogNumber: form.catalogNumber,
      unit: form.unit,
      lots: [
        {
          id: form.lotId || (form.id ? `${form.id}-lot-1` : `lot-${Date.now()}`),
          lotNumber: form.lotNumber,
          location: form.location,
          quantity: Number(form.quantity),
          unit: form.unit,
          expirationDate: form.expirationDate,
          status: "available",
          notes: form.notes,
        },
      ],
    });
    setForm(EMPTY_FORM);
  };

  return (
    <>
      <div className="topbar">
        <h1>Inventory</h1>
      </div>
      <div className={`inventory-content${canManageInventory ? "" : " read-only"}`}>
        {canManageInventory ? (
          <form className="inventory-editor-card" onSubmit={submit}>
            <h2>{form.id ? "Edit Inventory Item" : "New Inventory Item"}</h2>
            <div className="inventory-form-grid">
              <label className="modal-field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="modal-field"><span>Category</span><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
              <label className="modal-field"><span>Vendor</span><input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></label>
              <label className="modal-field"><span>Catalog #</span><input value={form.catalogNumber} onChange={(e) => setForm({ ...form, catalogNumber: e.target.value })} /></label>
              <label className="modal-field"><span>Lot #</span><input value={form.lotNumber} onChange={(e) => setForm({ ...form, lotNumber: e.target.value })} required /></label>
              <label className="modal-field"><span>Location</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label className="modal-field"><span>Quantity</span><input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></label>
              <label className="modal-field"><span>Unit</span><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
              <label className="modal-field"><span>Expiration</span><input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} /></label>
            </div>
            <label className="modal-field"><span>Notes</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></label>
            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setForm(EMPTY_FORM)}>Reset</button>
              <button className="btn-primary" type="submit">Save Inventory</button>
            </div>
          </form>
        ) : (
          <div className="inventory-readonly-note">Inventory lots are read-only for your current lab role.</div>
        )}

        <div className="inventory-list">
          {inventoryItems.length === 0 && <div className="empty-row">No inventory items yet.</div>}
          {inventoryItems.map((item) => (
            <article key={item.id} className="inventory-card">
              <div className="inventory-card-header">
                <div>
                  <h2>{item.name}</h2>
                  <p>{item.vendor} {item.catalogNumber}</p>
                </div>
                {canManageInventory && <button className="btn-secondary" onClick={() => edit(item)}>Edit</button>}
              </div>
              <div className="inventory-lot-list">
                {item.lots.map((lot) => (
                  <div key={lot.id} className={`inventory-lot ${lot.status}`}>
                    <div>
                      <strong>{lot.lotNumber}</strong>
                      <span>{lot.location || "No location"} - exp {lot.expirationDate || "n/a"}</span>
                    </div>
                    {canManageInventory ? (
                      <input
                        type="number"
                        value={lot.quantity}
                        onChange={(e) => adjustInventoryLot(item.id, lot.id, Number(e.target.value))}
                      />
                    ) : (
                      <span>{lot.quantity}</span>
                    )}
                    <span>{lot.unit}</span>
                    <small>{lot.status}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

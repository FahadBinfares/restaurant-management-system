import { useState } from "react";
import { mockOrders } from "../data/mockOrdes";

export default function Orders() {
  const [dataSelected, setDataSelected] = useState("");
  const [orderState, setOrderState] = useState("");

  const sorted = mockOrders.toSorted(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  const filtered = dataSelected
    ? sorted.filter((item) => item.scheduledAt.split("T")[0] === dataSelected)
    : sorted;

  const Orders = orderState
    ? filtered.filter(
        (order) => order.status === orderState || orderState === "all",
      )
    : filtered;

  function handleOrderByDate(e) {
    setDataSelected(e.target.value);
  }

  function handleOrderStateFilter(e) {
    setOrderState(e.target.value);
  }

  return (
    <div>
      <div className="flex gap-3">
        <input
          type="date"
          className="bg-amber-50 border-2 rounded-2xl p-2  mb-4"
          onChange={handleOrderByDate}
          value={dataSelected}
        />
        <button
          onClick={() => {
            setDataSelected("");
            setOrderState("");
          }}
          className="bg-black rounded-2xl h-fit p-3 text-white"
        >
          All Orders
        </button>
        <select onChange={handleOrderStateFilter} value={orderState}>
          <option value={"all"}>جميع الطلبات</option>
          <option value={"confirmed"}>تم التاكيد</option>
          <option value={"delivered"}>تم التسليم</option>
          <option value={"cancelled"}>ملغي</option>
        </select>
      </div>
      <div className="flex flex-col gap-22 ">
        {Orders.length === 0 ? (
          <h3 className="flex  self-center py-16 text-4xl text-red-700">
            لايوجد طلبات في التاريخ المحدد
          </h3>
        ) : (
          Orders.map((Order) => (
            <div className="flex gap-6" key={Order.id}>
              <h3>ID: {Order.id} </h3>
              <h3>رقم العميل المميز{Order.customerId} </h3>
              <h3>نوع التوصيل {Order.deliveryType} </h3>
              <h3>تاريخ تسليم الطلب {Order.scheduledAt} </h3>
              <h3>حاله الطلب:{Order.status} </h3>
              <div>
                الطلب
                {Order.items.map((order) => (
                  <div key={order.id} className="flex gap-2">
                    <h4>{order.name}:</h4>
                    <h4>الكمية: {order.quantity}</h4>
                    <h4>{order.unitPrice}ريال</h4>
                  </div>
                ))}
                <h4>
                  {"المجموع: "}
                  {Order.items.reduce((acc, obj) => {
                    return acc + obj.quantity * obj.unitPrice;
                  }, 0)}
                  ريال
                </h4>
              </div>
              <h2 className="text-red-600 font-bold">{Order.notes}</h2>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

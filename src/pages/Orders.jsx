import { useState } from "react";
import { mockOrders } from "../data/mockOrdes";
import calculateOrderTotal from "../utils/calculateOrderTotal";

export default function Orders() {
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const sortedOrders = mockOrders.toSorted(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  const dateFilteredOrders = selectedDate
    ? sortedOrders.filter(
        (item) => item.scheduledAt.split("T")[0] === selectedDate,
      )
    : sortedOrders;

  const Orders = selectedStatus
    ? dateFilteredOrders.filter(
        (order) => order.status === selectedStatus || selectedStatus === "all",
      )
    : dateFilteredOrders;

  function handleOrderByDate(e) {
    setSelectedDate(e.target.value);
  }

  function handleOrderStateFilter(e) {
    setSelectedStatus(e.target.value);
  }

  return (
    <div>
      <div className="flex gap-3">
        <input
          type="date"
          className="bg-amber-50 border-2 rounded-2xl p-2  mb-4"
          onChange={handleOrderByDate}
          value={selectedDate}
        />
        <button
          onClick={() => {
            setSelectedDate("");
            setSelectedStatus("");
          }}
          className="bg-black rounded-2xl h-fit p-3 text-white"
        >
          All Orders
        </button>
        <select onChange={handleOrderStateFilter} value={selectedStatus}>
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
                {Order.items.map((item) => (
                  <div key={item.id} className="flex gap-2">
                    <h4>{item.name}:</h4>
                    <h4>الكمية: {item.quantity}</h4>
                    <h4>{item.unitPrice}ريال</h4>
                  </div>
                ))}
                <h4>
                  {"المجموع: "}
                  {calculateOrderTotal(Order.items)}
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

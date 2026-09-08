// Export utility functions for payment methods
import { downloadPDF } from "../commonPDFExport"
export const exportPaymentMethodsToCSV = (methods, filename = "payment_methods") => {
  const headers = ["SI", "Payment Method Name", "Payment Info", "Required Info From Customer", "Status"]
  const rows = methods.map((method, index) => [
    index + 1,
    method.name,
    method.paymentInfo,
    method.requiredInfo,
    method.status ? "Active" : "Inactive"
  ])
  
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.csv`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportPaymentMethodsToExcel = (methods, filename = "payment_methods") => {
  const headers = ["SI", "Payment Method Name", "Payment Info", "Required Info From Customer", "Status"]
  const rows = methods.map((method, index) => [
    index + 1,
    method.name,
    method.paymentInfo,
    method.requiredInfo,
    method.status ? "Active" : "Inactive"
  ])
  
  const csvContent = [
    headers.join("\t"),
    ...rows.map(row => row.join("\t"))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "application/vnd.ms-excel" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}


export const exportPaymentMethodsToPDF = async (methods, filename = "payment_methods") => {
  const headers = ["SI", "Payment Method Name", "Payment Info", "Required Info From Customer", "Status"]
  const rows = methods.map((method, index) => [
    index + 1,
    method.name,
    method.paymentInfo,
    method.requiredInfo,
    method.status ? "Active" : "Inactive"
  ])
  
  await downloadPDF({ headers, rows, filename, title: "Payment Methods Report" })
}

export const exportPaymentMethodsToJSON = (methods, filename = "payment_methods") => {
  const jsonContent = JSON.stringify(methods, null, 2)
  const blob = new Blob([jsonContent], { type: "application/json" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.json`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}


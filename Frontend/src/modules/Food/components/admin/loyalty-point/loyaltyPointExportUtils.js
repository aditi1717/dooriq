import { downloadPDF } from "../commonPDFExport"
// Export utility functions for loyalty point reports
export const exportLoyaltyPointsToCSV = (transactions, filename = "loyalty_points_report") => {
  const headers = ["SI", "Transaction ID", "Customer", "Credit", "Debit", "Balance", "Transaction Type", "Reference", "Created At"]
  const rows = transactions.map((transaction) => [
    transaction.sl,
    transaction.transactionId,
    transaction.customer,
    transaction.credit,
    transaction.debit,
    transaction.balance,
    transaction.transactionType,
    transaction.reference,
    transaction.createdAt
  ])
  
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
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

export const exportLoyaltyPointsToExcel = (transactions, filename = "loyalty_points_report") => {
  const headers = ["SI", "Transaction ID", "Customer", "Credit", "Debit", "Balance", "Transaction Type", "Reference", "Created At"]
  const rows = transactions.map((transaction) => [
    transaction.sl,
    transaction.transactionId,
    transaction.customer,
    transaction.credit,
    transaction.debit,
    transaction.balance,
    transaction.transactionType,
    transaction.reference,
    transaction.createdAt
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

export const exportLoyaltyPointsToPDF = async (transactions, filename = "loyalty_points_report") => {
  const headers = ["SI", "Transaction ID", "Customer", "Credit", "Debit", "Balance", "Transaction Type", "Reference", "Created At"]
  const rows = transactions.map((transaction) => [
    transaction.sl,
    transaction.transactionId,
    transaction.customer,
    transaction.credit,
    transaction.debit,
    transaction.balance,
    transaction.transactionType,
    transaction.reference,
    transaction.createdAt
  ])
  
  await downloadPDF({ headers, rows, filename, title: "Loyalty Points Report" })
}

export const exportLoyaltyPointsToJSON = (transactions, filename = "loyalty_points_report") => {
  const jsonContent = JSON.stringify(transactions, null, 2)
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


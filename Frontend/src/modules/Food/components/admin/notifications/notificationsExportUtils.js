import { downloadPDF } from "../commonPDFExport"
// Export utility functions for notifications
export const exportNotificationsToCSV = (notifications, filename = "notifications") => {
  const headers = ["SI", "Topic", "Description", "Push Notification", "Mail", "SMS"]
  const rows = notifications.map((notif, index) => [
    index + 1,
    notif.topic,
    notif.description,
    notif.pushNotification,
    notif.mail ? "Yes" : "No",
    notif.sms !== false ? (notif.sms ? "Yes" : "No") : "N/A"
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

export const exportNotificationsToExcel = (notifications, filename = "notifications") => {
  const headers = ["SI", "Topic", "Description", "Push Notification", "Mail", "SMS"]
  const rows = notifications.map((notif, index) => [
    index + 1,
    notif.topic,
    notif.description,
    notif.pushNotification,
    notif.mail ? "Yes" : "No",
    notif.sms !== false ? (notif.sms ? "Yes" : "No") : "N/A"
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

export const exportNotificationsToPDF = async (notifications, filename = "notifications") => {
  const headers = ["SI", "Topic", "Description", "Push Notification", "Mail", "SMS"]
  const rows = notifications.map((notif, index) => [
    index + 1,
    notif.topic,
    notif.description,
    notif.pushNotification,
    notif.mail ? "Yes" : "No",
    notif.sms !== false ? (notif.sms ? "Yes" : "No") : "N/A"
  ])
  
  await downloadPDF({ headers, rows, filename, title: "Notifications Report" })
}

export const exportNotificationsToJSON = (notifications, filename = "notifications") => {
  const jsonContent = JSON.stringify(notifications, null, 2)
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


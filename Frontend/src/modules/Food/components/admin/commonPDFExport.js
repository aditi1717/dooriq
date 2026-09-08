/**
 * Generic helper to download PDF directly using jsPDF and jsPDF-AutoTable.
 */
export const downloadPDF = async ({ headers, rows, filename = "export", title = "Report", orientation = 'landscape' }) => {
  try {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: 'a4'
    })

    // Title
    doc.setFontSize(16)
    doc.setTextColor(30, 30, 30)
    doc.text(title, 14, 15)
    
    // Export info
    const reportDate = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(`Exported on: ${reportDate} | Total Records: ${rows.length}`, 14, 22)

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 28,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 }
    })

    const fileTimestamp = new Date().toISOString().split("T")[0]
    doc.save(`${filename}_${fileTimestamp}.pdf`)
  } catch (error) {
    console.error("PDF export error:", error)
    alert("Failed to export PDF. Please try again.")
  }
}
export default downloadPDF

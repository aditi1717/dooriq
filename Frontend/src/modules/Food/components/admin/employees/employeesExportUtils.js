import { downloadPDF } from "../commonPDFExport"
// Export utility functions for employee management

export const exportEmployeesToCSV = (employees, headers, filename = "employees") => {
  const csvContent = [
    headers.map(h => `"${h.label}"`).join(","),
    ...employees.map(row => headers.map(h => {
      const value = row[h.key];
      if (value === null || value === undefined) return '""';
      if (Array.isArray(value)) return `"${value.join(', ')}"`;
      if (typeof value === 'number') return value;
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportEmployeesToExcel = (employees, headers, filename = "employees") => {
  const excelContent = [
    headers.map(h => h.label).join("\t"),
    ...employees.map(row => headers.map(h => {
      const value = row[h.key];
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) return value.join(', ');
      return String(value).replace(/\t/g, ' ');
    }).join("\t"))
  ].join("\n");

  const blob = new Blob([excelContent], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportEmployeesToPDF = async (employees, headers, filename = "employees", title = "Employee Report") => {
  const headerLabels = headers.map(h => h.label)
  const rows = employees.map(row => 
    headers.map(h => {
      const value = row[h.key]
      if (Array.isArray(value)) return value.join(', ')
      return value || ''
    })
  )
  
  await downloadPDF({ headers: headerLabels, rows, filename, title })
};

export const exportEmployeesToJSON = (employees, filename = "employees") => {
  const jsonContent = JSON.stringify(employees, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.json`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};











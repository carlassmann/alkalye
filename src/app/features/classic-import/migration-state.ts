import { createContext, useContext } from "react"
export { ClassicImportPending, useClassicImportPending }
let ClassicImportPending = createContext(false)
function useClassicImportPending() {
	return useContext(ClassicImportPending)
}

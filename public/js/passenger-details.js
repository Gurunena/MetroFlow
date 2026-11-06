document.addEventListener("DOMContentLoaded", function () {
    const passengerForm = document.getElementById("passengerForm");
    const passengerId = document.getElementById("passengerId");
    const fullName = document.getElementById("fullName");
    const nic = document.getElementById("nic");
    const phone = document.getElementById("phone");
    const email = document.getElementById("email");
    const address = document.getElementById("address");
    const gender = document.getElementById("gender");

    const formTitle = document.getElementById("formTitle");
    const savePassengerBtn = document.getElementById("savePassengerBtn");
    const cancelEditBtn = document.getElementById("cancelEditBtn");

    const passengerTableBody = document.getElementById("passengerTableBody");
    const passengerSearch = document.getElementById("passengerSearch");
    const passengerMessage = document.getElementById("passengerMessage");

    const detailsModal = document.getElementById("passengerDetailsModal");
    const detailsContent = document.getElementById("passengerDetailsContent");
    const closeDetailsBtn = document.getElementById("closePassengerDetails");

    let passengers = JSON.parse(localStorage.getItem("metroflowPassengers")) || [];

    // ADD OR UPDATE PASSENGER
    passengerForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const passenger = {
            id: passengerId.value || Date.now().toString(),
            fullName: fullName.value.trim(),
            nic: nic.value.trim(),
            phone: phone.value.trim(),
            email: email.value.trim(),
            address: address.value.trim(),
            gender: gender.value
        };

        if (passengerId.value) {
            passengers = passengers.map(function (item) {
                return item.id === passenger.id ? passenger : item;
            });

            showMessage("Passenger updated successfully.", "success");
        } else {
            passengers.push(passenger);
            showMessage("Passenger added successfully.", "success");
        }

        savePassengers();
        renderPassengers();
        resetForm();
    });

    // DISPLAY PASSENGERS
    function renderPassengers() {
        const searchText = passengerSearch.value.toLowerCase();

        const filteredPassengers = passengers.filter(function (passenger) {
            return (
                passenger.fullName.toLowerCase().includes(searchText) ||
                passenger.nic.toLowerCase().includes(searchText) ||
                passenger.phone.toLowerCase().includes(searchText) ||
                passenger.email.toLowerCase().includes(searchText)
            );
        });

        passengerTableBody.innerHTML = "";

        if (filteredPassengers.length === 0) {
            passengerTableBody.innerHTML =
                '<tr><td colspan="6">No passengers found.</td></tr>';
            return;
        }

        filteredPassengers.forEach(function (passenger, index) {
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${escapeHTML(passenger.fullName)}</td>
                <td>${escapeHTML(passenger.nic)}</td>
                <td>${escapeHTML(passenger.phone)}</td>
                <td>${escapeHTML(passenger.email)}</td>
                <td>
                    <button class="view-btn" data-action="view" data-id="${passenger.id}">
                        View
                    </button>
                    <button class="edit-btn" data-action="edit" data-id="${passenger.id}">
                        Edit
                    </button>
                    <button class="delete-btn" data-action="delete" data-id="${passenger.id}">
                        Delete
                    </button>
                </td>
            `;

            passengerTableBody.appendChild(row);
        });
    }

    // VIEW, EDIT AND DELETE BUTTONS
    passengerTableBody.addEventListener("click", function (event) {
        const button = event.target.closest("button");

        if (!button) return;

        const id = button.dataset.id;
        const action = button.dataset.action;

        const passenger = passengers.find(function (item) {
            return item.id === id;
        });

        if (!passenger) return;

        if (action === "view") {
            viewPassenger(passenger);
        }

        if (action === "edit") {
            editPassenger(passenger);
        }

        if (action === "delete") {
            deletePassenger(passenger);
        }
    });

    // VIEW PASSENGER DETAILS
    function viewPassenger(passenger) {
        detailsContent.innerHTML = `
            <p><strong>Full Name:</strong> ${escapeHTML(passenger.fullName)}</p>
            <p><strong>NIC / Passport:</strong> ${escapeHTML(passenger.nic)}</p>
            <p><strong>Phone:</strong> ${escapeHTML(passenger.phone)}</p>
            <p><strong>Email:</strong> ${escapeHTML(passenger.email)}</p>
            <p><strong>Address:</strong> ${escapeHTML(passenger.address || "Not provided")}</p>
            <p><strong>Gender:</strong> ${escapeHTML(passenger.gender || "Not provided")}</p>
        `;

        detailsModal.hidden = false;
    }

    // EDIT PASSENGER
    function editPassenger(passenger) {
        passengerId.value = passenger.id;
        fullName.value = passenger.fullName;
        nic.value = passenger.nic;
        phone.value = passenger.phone;
        email.value = passenger.email;
        address.value = passenger.address;
        gender.value = passenger.gender;

        formTitle.textContent = "Edit Passenger";
        savePassengerBtn.innerHTML = '<i class="bi bi-pencil"></i> Update Passenger';
        cancelEditBtn.hidden = false;

        passengerForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    // DELETE PASSENGER
    function deletePassenger(passenger) {
        const confirmed = confirm(
            "Are you sure you want to delete " + passenger.fullName + "?"
        );

        if (!confirmed) return;

        passengers = passengers.filter(function (item) {
            return item.id !== passenger.id;
        });

        savePassengers();
        renderPassengers();

        showMessage("Passenger deleted successfully.", "success");

        if (passengerId.value === passenger.id) {
            resetForm();
        }
    }

    // SEARCH PASSENGERS
    passengerSearch.addEventListener("input", renderPassengers);

    // CANCEL EDIT
    cancelEditBtn.addEventListener("click", resetForm);

    // CLOSE DETAILS MODAL
    closeDetailsBtn.addEventListener("click", function () {
        detailsModal.hidden = true;
    });

    detailsModal.addEventListener("click", function (event) {
        if (event.target === detailsModal) {
            detailsModal.hidden = true;
        }
    });

    // RESET FORM
    function resetForm() {
        passengerForm.reset();
        passengerId.value = "";

        formTitle.textContent = "Add Passenger";
        savePassengerBtn.innerHTML =
            '<i class="bi bi-person-plus"></i> Add Passenger';

        cancelEditBtn.hidden = true;
    }

    // SAVE TO LOCAL STORAGE
    function savePassengers() {
        localStorage.setItem(
            "metroflowPassengers",
            JSON.stringify(passengers)
        );
    }

    // SHOW MESSAGE
    function showMessage(message, type) {
        passengerMessage.textContent = message;

        passengerMessage.className =
            type === "success"
                ? "alert alert-success mt-3"
                : "alert alert-danger mt-3";

        setTimeout(function () {
            passengerMessage.textContent = "";
            passengerMessage.className = "";
        }, 3000);
    }

    // PREVENT HTML INJECTION IN DISPLAYED VALUES
    function escapeHTML(value) {
        return String(value || "").replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[character];
        });
    }

    // INITIAL DISPLAY
    renderPassengers();
});
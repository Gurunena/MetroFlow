
document.addEventListener("DOMContentLoaded", function () {

    const seatGrid = document.getElementById("seatGrid");

    const availableSeatCount = document.getElementById("availableSeatCount");
    const occupiedSeatCount = document.getElementById("occupiedSeatCount");
    const selectedSeatCount = document.getElementById("selectedSeatCount");

    const selectedSeatsList = document.getElementById("selectedSeatsList");
    const seatMessage = document.getElementById("seatMessage");
    const refreshButton = document.getElementById("refreshSeatAvailability");

    // Check required elements
    if (!seatGrid) {
        console.error("Seat grid not found.");
        return;
    }

    // Select and deselect seats
    seatGrid.addEventListener("click", function (event) {

        const seat = event.target.closest(".seat");

        if (!seat || seat.disabled || seat.classList.contains("booked")) {
            return;
        }

        if (seat.classList.contains("selected")) {

            seat.classList.remove("selected");
            seat.classList.add("available");

            showMessage(seat.dataset.seat + " deselected.");

        } else {

            seat.classList.remove("available");
            seat.classList.add("selected");

            showMessage(seat.dataset.seat + " selected.");

        }

        updateSeatAvailability();

    });

    // Update seat counts and selected seat numbers
    function updateSeatAvailability() {

        const seats = seatGrid.querySelectorAll(".seat");

        let available = 0;
        let occupied = 0;
        let selected = 0;

        const selectedSeatNumbers = [];

        seats.forEach(function (seat) {

            if (seat.classList.contains("booked")) {

                occupied++;

                seat.disabled = true;

                seat.setAttribute(
                    "aria-label",
                    seat.dataset.seat + " occupied"
                );

            } else if (seat.classList.contains("selected")) {

                selected++;

                selectedSeatNumbers.push(seat.dataset.seat);

                seat.disabled = false;

                seat.setAttribute(
                    "aria-label",
                    seat.dataset.seat + " selected"
                );

            } else {

                available++;

                seat.disabled = false;

                seat.setAttribute(
                    "aria-label",
                    seat.dataset.seat + " available"
                );

            }

        });

        // Update counts safely
        if (availableSeatCount) {
            availableSeatCount.textContent = available;
        }

        if (occupiedSeatCount) {
            occupiedSeatCount.textContent = occupied;
        }

        if (selectedSeatCount) {
            selectedSeatCount.textContent = selected;
        }

        // Update selected seats list
        displaySelectedSeats(selectedSeatNumbers);

    }

    // Display selected seat numbers
    function displaySelectedSeats(seatNumbers) {

        if (!selectedSeatsList) {
            console.error("Selected seats list not found.");
            return;
        }

        selectedSeatsList.innerHTML = "";

        if (seatNumbers.length === 0) {

            selectedSeatsList.innerHTML =
                '<p class="empty-seats">No seats selected yet.</p>';

            return;

        }

        seatNumbers.forEach(function (seatNumber) {

            const seatItem = document.createElement("span");

            seatItem.className = "selected-seat-item";

            seatItem.textContent = seatNumber;

            selectedSeatsList.appendChild(seatItem);

        });

    }

    // Refresh availability without removing selected seats
    if (refreshButton) {

        refreshButton.addEventListener("click", function () {

            // Keep currently selected seats
            const selectedSeatsBeforeRefresh = Array.from(
                seatGrid.querySelectorAll(".seat.selected")
            ).map(function (seat) {
                return seat.dataset.seat;
            });

            // Update counts and selected seat display
            updateSeatAvailability();

            // Check selected seats after refresh
            const selectedSeatsAfterRefresh = Array.from(
                seatGrid.querySelectorAll(".seat.selected")
            ).map(function (seat) {
                return seat.dataset.seat;
            });

            console.log(
                "Selected seats before refresh:",
                selectedSeatsBeforeRefresh
            );

            console.log(
                "Selected seats after refresh:",
                selectedSeatsAfterRefresh
            );

            showMessage("Seat availability refreshed.");

        });

    } else {

        console.error("Refresh button not found.");

    }

    // Show message
    function showMessage(message) {

        if (!seatMessage) {
            console.error(message);
            return;
        }

        seatMessage.textContent = message;

        seatMessage.className = "alert alert-success mt-3";

    }

    // Initial update
    updateSeatAvailability();

});
